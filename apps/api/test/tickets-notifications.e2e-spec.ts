import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaClient, Role } from '@prisma/client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { TicketsService } from 'src/modules/tickets/tickets.service';
import { TicketNotificationsService } from 'src/modules/tickets/ticket-notifications.service';
import { StaffActor } from 'src/modules/tickets/tickets.types';
import { TICKET_EXCERPT_MAX_CHARS } from 'src/modules/tickets/tickets.constants';
import { QUEUE_NOTIFICATIONS } from 'src/infra/queue/queue.constants';
import { NOTIFICATION_JOB } from 'src/infra/queue/notification.types';

/**
 * Atención al usuario R4 — los AVISOS (Notification in-app + email auxiliar).
 *
 * Se ejerce por la capa de servicio y se observa por los DOS lados del efecto:
 * las filas `Notification` que quedan en Postgres, y los jobs que se encolan en
 * BullMQ. Para lo segundo se espía `queue.add` en vez de levantar un worker
 * real: lo que R4 tiene que garantizar es QUÉ se encola y CUÁNTOS (uno solo al
 * soporte, N notificaciones in-app) y con QUÉ CUERPO — que el email no lleve la
 * conversación. Que Resend entregue no es cosa de esta ráfaga.
 *
 * Las dos invariantes del diseño que aquí se ponen a prueba:
 *   §11 — el aviso NO transporta la conversación (extracto ≤140 + enlace).
 *   §14.4 — fan-out in-app sí, email a supportEmail NO fan-out.
 */
describe('Tickets — notificaciones y email (R4) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tickets: TicketsService;
  let addSpy: jest.SpyInstance;

  let userId: string;
  let adminId: string;
  let moderatorId: string;
  let staff: StaffActor;

  const SUPPORT_EMAIL = 'soporte@marketplace.test';

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    tickets = app.get(TicketsService);

    // Espía sobre la Queue que inyecta TicketNotificationsService.
    const queue = app.get<{ add: (...a: unknown[]) => unknown }>(getQueueToken(QUEUE_NOTIFICATIONS));
    addSpy = jest.spyOn(queue, 'add').mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
    addSpy.mockRestore();
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    addSpy.mockClear();
    await prisma.setting.upsert({
      where: { key: 'supportEmail' },
      update: { value: SUPPORT_EMAIL },
      create: { key: 'supportEmail', value: SUPPORT_EMAIL },
    });

    userId = (await createUser('USER')).id;
    adminId = (await createUser('ADMIN')).id;
    moderatorId = (await createUser('MODERATOR')).id;
    staff = { userId: adminId, role: 'ADMIN' };
  });

  afterEach(async () => {
    // `Setting` no lo toca cleanDb (es dato de sistema compartido entre suites):
    // hay que retirarlo a mano o la clave sobrevive a esta suite.
    await prisma.setting.deleteMany({ where: { key: 'supportEmail' } });
  });

  // --- helpers -------------------------------------------------------------

  async function createUser(role: Role) {
    const id = randomUUID().slice(0, 8);
    return prisma.user.create({
      data: { email: `tkn-${id}@test.local`, name: `Tkn ${id}`, slug: `tkn-${id}`, role },
    });
  }

  const notifsOf = (uid: string, type?: string) =>
    prisma.notification.findMany({ where: { userId: uid, ...(type && { type }) } });

  /** Jobs encolados de un tipo concreto, con su payload. */
  const jobs = (name: string) =>
    addSpy.mock.calls.filter((c) => c[0] === name).map((c) => c[1] as Record<string, unknown>);

  // ===========================================================================
  // Usuario abre ticket → fan-out in-app al staff + UN email a soporte
  // ===========================================================================

  describe('el usuario abre un ticket (flujo a)', () => {
    it('crea una Notification TICKET_STAFF_NEW por CADA agente, y UN SOLO email a soporte', async () => {
      const ticket = await tickets.createByUser(userId, {
        subject: 'No puedo publicar',
        body: 'Me da error al guardar el anuncio',
      });

      // Fan-out in-app: uno por agente (Notification es userId 1:1, no hay buzón de rol).
      const todas = await prisma.notification.findMany({ where: { type: 'TICKET_STAFF_NEW' } });
      expect(todas).toHaveLength(2); // admin + moderator
      expect(todas.map((n) => n.userId).sort()).toEqual([adminId, moderatorId].sort());

      // Email: UNO SOLO, a la dirección de soporte — NO uno por administrador.
      const emails = jobs(NOTIFICATION_JOB.SEND_TICKET_STAFF_NOTIFICATION);
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toBe(SUPPORT_EMAIL);
      expect(emails[0].kind).toBe('new');
      expect(emails[0].ticketId).toBe(ticket.id);

      // Al usuario no se le avisa de su propio ticket.
      expect(await notifsOf(userId)).toHaveLength(0);
    });

    it('el data lleva NOMBRES resueltos (userName, topic), nunca ids', async () => {
      const topic = await prisma.contactReason.create({
        data: { nombre: 'Problema con mi anuncio', scope: 'TICKET' },
      });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

      await tickets.createByUser(userId, {
        subject: 'Ayuda',
        body: 'Necesito ayuda',
        topicId: topic.id,
      });

      const [n] = await notifsOf(adminId, 'TICKET_STAFF_NEW');
      const data = n.data as Record<string, unknown>;
      expect(data.userName).toBe(user.name);
      expect(data.topic).toBe('Problema con mi anuncio');
      // Y NO los ids: un snapshot con punteros obligaría a consultar al pintar y
      // dejaría de ser legible si el motivo se renombra (RC.2).
      expect(data.topic).not.toBe(topic.id);
      expect(data.userName).not.toBe(userId);
    });

    it('sin supportEmail configurado: NO se manda email, pero el fan-out in-app SÍ ocurre', async () => {
      await prisma.setting.deleteMany({ where: { key: 'supportEmail' } });

      await tickets.createByUser(userId, { subject: 'Ayuda', body: 'Hola' });

      expect(jobs(NOTIFICATION_JOB.SEND_TICKET_STAFF_NOTIFICATION)).toHaveLength(0);
      // Ningún aviso se pierde: la campana de cada agente sigue sonando.
      expect(await prisma.notification.count({ where: { type: 'TICKET_STAFF_NEW' } })).toBe(2);
    });
  });

  // ===========================================================================
  // §11 — el aviso NO transporta la conversación
  // ===========================================================================

  describe('§11: ni la notificación ni el email llevan la conversación', () => {
    const LARGO =
      'Hola, os escribo porque llevo tres días intentando publicar un anuncio de una bicicleta de montaña ' +
      'y el formulario me da un error genérico al llegar al último paso, justo cuando subo las fotos. ' +
      'He probado con Chrome y con Firefox, en dos ordenadores distintos, y siempre pasa lo mismo. ' +
      'Adjunto todos los detalles que se me ocurren por si sirven de algo.';

    it('el extracto se corta a 140 caracteres y el cuerpo entero NO viaja', async () => {
      expect(LARGO.length).toBeGreaterThan(TICKET_EXCERPT_MAX_CHARS); // el test tiene sentido

      await tickets.createByUser(userId, { subject: 'Error al publicar', body: LARGO });

      const [n] = await notifsOf(adminId, 'TICKET_STAFF_NEW');
      const extracto = (n.data as { extracto: string }).extracto;

      expect(extracto.length).toBe(TICKET_EXCERPT_MAX_CHARS + 1); // 140 + el carácter '…'
      expect(extracto.endsWith('…')).toBe(true);
      expect(extracto).not.toBe(LARGO);
      // LA PRUEBA: el cuerpo entero no está en ninguna parte del payload servido.
      expect(JSON.stringify(n.data)).not.toContain(LARGO);
      expect(JSON.stringify(n.data)).not.toContain('Adjunto todos los detalles');
    });

    it('el email tampoco: solo extracto y enlace, nunca el body', async () => {
      await tickets.createByUser(userId, { subject: 'Error al publicar', body: LARGO });

      const [email] = jobs(NOTIFICATION_JOB.SEND_TICKET_STAFF_NOTIFICATION);
      expect(JSON.stringify(email)).not.toContain(LARGO);
      expect((email.extracto as string).length).toBeLessThanOrEqual(TICKET_EXCERPT_MAX_CHARS + 1);
      // El payload no lleva un campo con la conversación: solo lo justo para
      // construir el aviso y el enlace.
      expect(Object.keys(email).sort()).toEqual(
        ['extracto', 'kind', 'subject', 'ticketId', 'to', 'userName'].sort(),
      );
    });

    it('un mensaje corto viaja íntegro (no se corta lo que no hace falta cortar)', async () => {
      await tickets.createByUser(userId, { subject: 'Duda', body: 'Corto' });
      const [n] = await notifsOf(adminId, 'TICKET_STAFF_NEW');
      expect((n.data as { extracto: string }).extracto).toBe('Corto');
    });
  });

  // ===========================================================================
  // Staff responde (T3/T4) → aviso al usuario
  // ===========================================================================

  describe('el staff responde (T3/T4)', () => {
    it('crea UNA Notification TICKET_MESSAGE para el usuario y UN email a su dirección', async () => {
      const ticket = await tickets.createByUser(userId, { subject: 'Duda', body: 'Hola' });
      addSpy.mockClear();

      await tickets.replyAsStaff(ticket.id, staff, 'Lo estamos revisando, te contamos en breve');

      const notifs = await notifsOf(userId, 'TICKET_MESSAGE');
      expect(notifs).toHaveLength(1);
      const data = notifs[0].data as Record<string, unknown>;
      expect(data.ticketId).toBe(ticket.id);
      expect(data.subject).toBe('Duda');
      expect(data.extracto).toBe('Lo estamos revisando, te contamos en breve');
      // Estado CONGELADO en el instante del aviso.
      expect(data.status).toBe('WAITING_USER');

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const emails = jobs(NOTIFICATION_JOB.SEND_TICKET_MESSAGE);
      expect(emails).toHaveLength(1);
      expect(emails[0].email).toBe(user.email);
      expect(emails[0].opened).toBe(false);
    });

    it('responder NO avisa al staff (el aviso al staff es solo para lo que escribe el usuario)', async () => {
      const ticket = await tickets.createByUser(userId, { subject: 'Duda', body: 'Hola' });
      const antes = await prisma.notification.count({ where: { type: 'TICKET_STAFF_NEW' } });

      await tickets.replyAsStaff(ticket.id, staff, 'Respuesta');

      expect(await prisma.notification.count({ where: { type: 'TICKET_STAFF_NEW' } })).toBe(antes);
    });
  });

  // ===========================================================================
  // Staff abre hilo (flujos b/c) → TICKET_OPENED
  // ===========================================================================

  describe('el staff abre un hilo (flujos b/c)', () => {
    it('avisa al usuario con TICKET_OPENED (no TICKET_MESSAGE: no es una respuesta)', async () => {
      const ticket = await tickets.createByStaff(staff, {
        userId,
        subject: 'Revisión de tu cuenta',
        body: 'Necesitamos que confirmes un dato',
        origin: 'ADMIN',
      });

      const abiertos = await notifsOf(userId, 'TICKET_OPENED');
      expect(abiertos).toHaveLength(1);
      expect((abiertos[0].data as { ticketId: string }).ticketId).toBe(ticket.id);
      expect(await notifsOf(userId, 'TICKET_MESSAGE')).toHaveLength(0);

      const emails = jobs(NOTIFICATION_JOB.SEND_TICKET_MESSAGE);
      expect(emails).toHaveLength(1);
      expect(emails[0].opened).toBe(true); // el copy del email cambia con esto
    });

    it('no dispara aviso al staff: lo ha abierto el propio staff', async () => {
      await tickets.createByStaff(staff, {
        userId,
        subject: 'Aviso',
        body: 'Hola',
        origin: 'ADMIN',
      });
      expect(await prisma.notification.count({ where: { type: 'TICKET_STAFF_NEW' } })).toBe(0);
      expect(jobs(NOTIFICATION_JOB.SEND_TICKET_STAFF_NOTIFICATION)).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Usuario responde → fan-out al staff
  // ===========================================================================

  describe('el usuario responde', () => {
    it('en WAITING_USER (T5): fan-out TICKET_STAFF_NEW + UN email a soporte, kind=reply', async () => {
      const ticket = await tickets.createByUser(userId, { subject: 'Duda', body: 'Hola' });
      await tickets.replyAsStaff(ticket.id, staff, 'Cuéntame más'); // → WAITING_USER
      addSpy.mockClear();
      await prisma.notification.deleteMany({ where: { type: 'TICKET_STAFF_NEW' } });

      await tickets.replyAsUser(ticket.id, userId, 'Ahí van los detalles');

      const staffNotifs = await prisma.notification.findMany({ where: { type: 'TICKET_STAFF_NEW' } });
      expect(staffNotifs).toHaveLength(2);
      expect((staffNotifs[0].data as { extracto: string }).extracto).toBe('Ahí van los detalles');

      const emails = jobs(NOTIFICATION_JOB.SEND_TICKET_STAFF_NOTIFICATION);
      expect(emails).toHaveLength(1);
      expect(emails[0].kind).toBe('reply');
      expect(emails[0].to).toBe(SUPPORT_EMAIL);
    });

    it('el usuario no se avisa a sí mismo al responder', async () => {
      const ticket = await tickets.createByUser(userId, { subject: 'Duda', body: 'Hola' });
      await tickets.replyAsStaff(ticket.id, staff, 'Dime');
      const antes = (await notifsOf(userId)).length;

      await tickets.replyAsUser(ticket.id, userId, 'Te digo');

      expect((await notifsOf(userId)).length).toBe(antes);
    });
  });

  // ===========================================================================
  // Staff resuelve (T7)
  // ===========================================================================

  describe('el staff resuelve (T7)', () => {
    it('avisa al usuario in-app y por email, con la ventana de reapertura', async () => {
      const ticket = await tickets.createByUser(userId, { subject: 'Duda', body: 'Hola' });
      await tickets.take(ticket.id, staff);
      addSpy.mockClear();
      await prisma.notification.deleteMany({});

      await tickets.resolve(ticket.id, staff);

      const notifs = await notifsOf(userId, 'TICKET_MESSAGE');
      expect(notifs).toHaveLength(1);
      expect((notifs[0].data as { status: string }).status).toBe('RESOLVED');

      const emails = jobs(NOTIFICATION_JOB.SEND_TICKET_RESOLVED);
      expect(emails).toHaveLength(1);
      expect(emails[0].reopenWindowDays).toBe(14);
      expect(emails[0].ticketId).toBe(ticket.id);
    });
  });

  // ===========================================================================
  // El aviso es EFECTO, nunca CAUSA
  // ===========================================================================

  describe('ningún aviso transiciona el ticket', () => {
    it('el estado tras cada transición es el que dicta la máquina, no el aviso', async () => {
      const ticket = await tickets.createByUser(userId, { subject: 'Duda', body: 'Hola' });
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe('OPEN');

      await tickets.replyAsStaff(ticket.id, staff, 'x');
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(
        'WAITING_USER',
      );

      await tickets.replyAsUser(ticket.id, userId, 'y');
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(
        'IN_PROGRESS',
      );
    });

    it('si la transición se RECHAZA, no se crea ninguna notificación ni se encola ningún email', async () => {
      const ticket = await tickets.createByUser(userId, { subject: 'Duda', body: 'Hola' });
      await tickets.closeAsStaff(ticket.id, staff);
      addSpy.mockClear();
      await prisma.notification.deleteMany({});

      // Todo esto rechaza (CLOSED es irreversible).
      await expect(tickets.replyAsStaff(ticket.id, staff, 'x')).rejects.toThrow();
      await expect(tickets.replyAsUser(ticket.id, userId, 'y')).rejects.toThrow();
      await expect(tickets.resolve(ticket.id, staff)).rejects.toThrow();

      expect(await prisma.notification.count()).toBe(0);
      expect(addSpy).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Defensa preparada: las notas internas no avisan
  // ===========================================================================

  describe('un mensaje internal NO dispara aviso (defensa preparada, §14.3)', () => {
    it('avisar de una nota interna delataría su existencia al usuario', async () => {
      const ticket = await tickets.createByUser(userId, { subject: 'Duda', body: 'Hola' });
      addSpy.mockClear();
      await prisma.notification.deleteMany({});

      // No hay vía de escritura en la app: se siembra en BD y se invoca el
      // servicio de avisos con ese mensaje, que es lo que haría el día que las
      // notas internas se implementen si nadie hubiera puesto el guard.
      const nota = await prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          authorId: adminId,
          side: 'STAFF',
          body: 'Sospechoso de fraude',
          internal: true,
        },
      });

      const notifier = app.get(TicketNotificationsService);
      await notifier.userStaffWrote(ticket, nota, false);
      await notifier.staffNewActivity(ticket, nota, 'reply');

      expect(await prisma.notification.count()).toBe(0);
      expect(addSpy).not.toHaveBeenCalled();
    });
  });
});
