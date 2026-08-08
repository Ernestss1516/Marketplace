import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role, Ticket } from '@prisma/client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { TicketsService } from 'src/modules/tickets/tickets.service';
import { TicketsScheduleService } from 'src/modules/tickets/tickets-schedule.service';
import { StaffActor } from 'src/modules/tickets/tickets.types';
import { TICKET_WINDOW_SETTING_KEY } from 'src/modules/tickets/tickets.constants';

/**
 * Atención al usuario R8 — CIERRE AUTOMÁTICO de los RESOLVED vencidos (T9).
 *
 * Se ejerce `runTicketAutoClose(now)` con la fecha INYECTADA, nunca esperando al
 * reloj (molde `invoicing-cron.e2e-spec.ts`): así se puede probar el día 13, el
 * 14 exacto y el 15 en la misma corrida.
 *
 * Con esta ráfaga TODAS las transiciones de la matriz §7.2 tienen disparador.
 */
describe('Tickets — cron de auto-cierre (R8) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tickets: TicketsService;
  let schedule: TicketsScheduleService;

  let userId: string;
  let staff: StaffActor;

  const DIA = 24 * 60 * 60 * 1000;
  /**
   * "Ahora" fijo para todos los cálculos.
   *
   * RELOJ COMPARTIDO — y hay que pasárselo a TODO lo que evalúe la ventana, no solo
   * al cron. `resolvedHaceDias` ancla `resolvedAt` a esta fecha; si algo la evaluara
   * con el reloj REAL, el escenario y su juez vivirían en instantes distintos y el
   * veredicto dependería del calendario del día en que se ejecute la batería. No es
   * hipotético: el guard de reapertura usaba `Date.now()` y este spec estuvo verde
   * por coincidencia hasta que el reloj real cruzó un deadline anclado aquí
   * (2026-08-08T05:00Z), momento desde el que quedó en rojo permanente. Por eso
   * `TicketsService.replyAsUser` acepta ahora el mismo `now` que
   * `runTicketAutoClose`, y los tests que atraviesan el guard se lo pasan.
   */
  const AHORA = new Date('2026-07-29T05:00:00.000Z');

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    tickets = app.get(TicketsService);
    schedule = app.get(TicketsScheduleService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    userId = (await createUser('USER')).id;
    const admin = await createUser('ADMIN');
    staff = { userId: admin.id, role: 'ADMIN' };
  });

  afterEach(async () => {
    // `Setting` no lo toca cleanDb (dato de sistema compartido entre suites):
    // hay que retirar la ventana a mano o se filtra a las siguientes.
    await prisma.setting.deleteMany({ where: { key: TICKET_WINDOW_SETTING_KEY } });
  });

  async function createUser(role: Role) {
    const id = randomUUID().slice(0, 8);
    return prisma.user.create({
      data: { email: `tkc-${id}@test.local`, name: `Tkc ${id}`, slug: `tkc-${id}`, role },
    });
  }

  /** Deja un ticket en RESOLVED con `resolvedAt` envejecido N días respecto a AHORA. */
  async function resolvedHaceDias(dias: number): Promise<Ticket> {
    const ticket = await tickets.createByUser(userId, { subject: 'Asunto', body: 'Hola' });
    await tickets.take(ticket.id, staff);
    await tickets.resolve(ticket.id, staff);
    return prisma.ticket.update({
      where: { id: ticket.id },
      data: { resolvedAt: new Date(AHORA.getTime() - dias * DIA) },
    });
  }

  const leer = (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id } });

  const setVentana = (dias: number) =>
    prisma.setting.upsert({
      where: { key: TICKET_WINDOW_SETTING_KEY },
      update: { value: dias },
      create: { key: TICKET_WINDOW_SETTING_KEY, value: dias },
    });

  // ===========================================================================
  // La ventana
  // ===========================================================================

  describe('ventana de 14 días (default, sin Setting)', () => {
    it('cierra un RESOLVED de hace 15 días: CLOSED, closedAt, y closedById NULL (lo cerró el sistema)', async () => {
      const ticket = await resolvedHaceDias(15);

      const res = await schedule.runTicketAutoClose(AHORA);

      expect(res.windowDays).toBe(14);
      expect(res.candidates).toBe(1);
      expect(res.closed).toBe(1);

      const after = await leer(ticket.id);
      expect(after.status).toBe('CLOSED');
      expect(after.closedAt).toEqual(AHORA);
      // El discriminante: null = sistema; un id = persona (staff o el propio usuario).
      expect(after.closedById).toBeNull();
    });

    it('NO cierra uno de hace 13 días (dentro de ventana)', async () => {
      const ticket = await resolvedHaceDias(13);

      const res = await schedule.runTicketAutoClose(AHORA);

      expect(res.candidates).toBe(0);
      expect(res.closed).toBe(0);
      expect((await leer(ticket.id)).status).toBe('RESOLVED');
    });

    it('FRONTERA: a los 14 días EXACTOS ya cierra (comparación inclusiva)', async () => {
      const ticket = await resolvedHaceDias(14);

      const res = await schedule.runTicketAutoClose(AHORA);

      expect(res.closed).toBe(1);
      expect((await leer(ticket.id)).status).toBe('CLOSED');
    });

    it('FRONTERA: un milisegundo ANTES de los 14 días todavía no', async () => {
      const ticket = await tickets.createByUser(userId, { subject: 'S', body: 'B' });
      await tickets.take(ticket.id, staff);
      await tickets.resolve(ticket.id, staff);
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { resolvedAt: new Date(AHORA.getTime() - 14 * DIA + 1) },
      });

      expect((await schedule.runTicketAutoClose(AHORA)).closed).toBe(0);
      expect((await leer(ticket.id)).status).toBe('RESOLVED');
    });
  });

  // ===========================================================================
  // Solo RESOLVED
  // ===========================================================================

  describe('solo toca los RESOLVED', () => {
    it('no toca OPEN, IN_PROGRESS ni WAITING_USER por muy antiguos que sean', async () => {
      const abierto = await tickets.createByUser(userId, { subject: 'Abierto', body: 'B' });

      const enCurso = await tickets.createByUser(userId, { subject: 'En curso', body: 'B' });
      await tickets.take(enCurso.id, staff);

      const esperando = await tickets.createByUser(userId, { subject: 'Esperando', body: 'B' });
      await tickets.replyAsStaff(esperando.id, staff, 'Te leo');

      // Se envejecen todos por si el query mirase createdAt en vez de status.
      const viejo = new Date(AHORA.getTime() - 90 * DIA);
      await prisma.ticket.updateMany({ data: { createdAt: viejo, lastMessageAt: viejo } });

      const res = await schedule.runTicketAutoClose(AHORA);

      expect(res.candidates).toBe(0);
      expect((await leer(abierto.id)).status).toBe('OPEN');
      expect((await leer(enCurso.id)).status).toBe('IN_PROGRESS');
      expect((await leer(esperando.id)).status).toBe('WAITING_USER');
    });
  });

  // ===========================================================================
  // Idempotencia
  // ===========================================================================

  describe('idempotencia natural (sin marca de última corrida)', () => {
    it('un segundo disparo el mismo día no re-cierra ni falla', async () => {
      const ticket = await resolvedHaceDias(20);

      const primera = await schedule.runTicketAutoClose(AHORA);
      expect(primera.closed).toBe(1);
      const cerradoEn = (await leer(ticket.id)).closedAt;

      // Segunda corrida: el ticket ya es CLOSED, así que deja de casar
      // `status = RESOLVED` — el propio estado de la fila ES la marca.
      const segunda = await schedule.runTicketAutoClose(AHORA);
      expect(segunda.candidates).toBe(0);
      expect(segunda.closed).toBe(0);

      // Y no se re-sella la fecha de cierre.
      const after = await leer(ticket.id);
      expect(after.closedAt).toEqual(cerradoEn);
      expect(after.status).toBe('CLOSED');
    });

    it('un ticket ya cerrado a mano por el staff no se reprocesa', async () => {
      const ticket = await resolvedHaceDias(30);
      await tickets.closeAsStaff(ticket.id, staff);
      const cerrado = await leer(ticket.id);
      expect(cerrado.closedById).toBe(staff.userId);

      const res = await schedule.runTicketAutoClose(AHORA);

      expect(res.candidates).toBe(0);
      // El cierre manual conserva su autor: el cron no lo pisa con null.
      expect((await leer(ticket.id)).closedById).toBe(staff.userId);
    });
  });

  // ===========================================================================
  // Anomalía: RESOLVED sin resolvedAt
  // ===========================================================================

  describe('RESOLVED sin resolvedAt (dato incoherente)', () => {
    it('NO se cierra, y se cuenta como anomalía para que salga a la luz', async () => {
      const ticket = await resolvedHaceDias(30);
      // Se rompe el dato a mano: resolve() siempre escribe resolvedAt, así que
      // esto no debería existir — pero si existiera, no puede cerrarse en
      // silencio (no hay desde cuándo contar la ventana).
      await prisma.ticket.update({ where: { id: ticket.id }, data: { resolvedAt: null } });

      const res = await schedule.runTicketAutoClose(AHORA);

      expect(res.candidates).toBe(0);
      expect(res.closed).toBe(0);
      expect(res.orphanResolved).toBe(1);
      expect((await leer(ticket.id)).status).toBe('RESOLVED');
    });
  });

  // ===========================================================================
  // Ventana configurable en caliente
  // ===========================================================================

  describe('ventana configurable vía Setting', () => {
    it('con la ventana en 7 días, un ticket de hace 10 que antes NO se cerraba, ahora sí', async () => {
      const ticket = await resolvedHaceDias(10);

      // Con el default (14) está dentro de ventana: no se toca.
      expect((await schedule.runTicketAutoClose(AHORA)).closed).toBe(0);
      expect((await leer(ticket.id)).status).toBe('RESOLVED');

      // El admin acorta la ventana a 7 — en caliente, sin desplegar.
      await setVentana(7);

      const res = await schedule.runTicketAutoClose(AHORA);
      expect(res.windowDays).toBe(7);
      expect(res.closed).toBe(1);
      expect((await leer(ticket.id)).status).toBe('CLOSED');
    });

    it('un valor inválido en el Setting cae al default en vez de romper', async () => {
      await prisma.setting.upsert({
        where: { key: TICKET_WINDOW_SETTING_KEY },
        update: { value: 'no-es-un-numero' },
        create: { key: TICKET_WINDOW_SETTING_KEY, value: 'no-es-un-numero' },
      });
      const ticket = await resolvedHaceDias(15);

      const res = await schedule.runTicketAutoClose(AHORA);

      expect(res.windowDays).toBe(14);
      expect((await leer(ticket.id)).status).toBe('CLOSED');
    });

    it('EL MISMO Setting gobierna el guard de reapertura (T8): no hay limbo entre ambos', async () => {
      // Este es el test que impide que cron y guard diverjan. Con la ventana en
      // 7, un ticket resuelto hace 10 días debe: (a) rechazar la reapertura del
      // usuario, y (b) ser cerrable por el cron. Si cada uno leyera su propio
      // número, habría un hueco en el que ni se puede reabrir ni se cierra.
      await setVentana(7);
      const ticket = await resolvedHaceDias(10);

      // AHORA al guard, igual que al cron dos líneas más abajo: 10 días > ventana
      // de 7 ⇒ rechaza. Con el reloj real esto pasaba SOLO, sin mirar la ventana
      // (ver la nota de reloj compartido arriba), así que la aserción no medía nada.
      await expect(
        tickets.replyAsUser(ticket.id, userId, 'Quiero reabrirlo', [], AHORA),
      ).rejects.toMatchObject({ response: { code: 'REOPEN_WINDOW_EXPIRED' } });

      expect((await schedule.runTicketAutoClose(AHORA)).closed).toBe(1);
    });

    it('dentro de la ventana configurada, la reapertura SIGUE funcionando', async () => {
      await setVentana(30);
      const ticket = await resolvedHaceDias(20); // fuera del default 14, dentro de 30

      const { ticket: reabierto } = await tickets.replyAsUser(
        ticket.id,
        userId,
        'Sigue fallando',
        [],
        AHORA,
      );
      expect(reabierto.status).toBe('IN_PROGRESS');

      // Y ya no es candidato: dejó de estar RESOLVED.
      expect((await schedule.runTicketAutoClose(AHORA)).candidates).toBe(0);
    });
  });

  // ===========================================================================
  // El cierre automático respeta la máquina de estados
  // ===========================================================================

  describe('el auto-cierre pasa por el núcleo de cierre, no lo bypassa', () => {
    it('tras el auto-cierre, CLOSED sigue siendo irreversible por todas las vías', async () => {
      const ticket = await resolvedHaceDias(20);
      await schedule.runTicketAutoClose(AHORA);

      await expect(tickets.replyAsUser(ticket.id, userId, 'x')).rejects.toThrow();
      await expect(tickets.replyAsStaff(ticket.id, staff, 'x')).rejects.toThrow();
      await expect(tickets.resolve(ticket.id, staff)).rejects.toThrow();
      await expect(tickets.closeAsStaff(ticket.id, staff)).rejects.toThrow();
      await expect(tickets.take(ticket.id, staff)).rejects.toThrow();

      expect((await leer(ticket.id)).status).toBe('CLOSED');
    });

    it('NO escribe AuditLog por ticket (AuditLog.actorId es NOT NULL: no hay actor humano)', async () => {
      const ticket = await resolvedHaceDias(20);
      const antes = await prisma.auditLog.count({ where: { resourceId: ticket.id } });

      await schedule.runTicketAutoClose(AHORA);

      // La trazabilidad la lleva la propia fila (closedAt + closedById=null), no
      // una entrada de auditoría con un actor inventado.
      expect(await prisma.auditLog.count({ where: { resourceId: ticket.id } })).toBe(antes);
    });

    it('NO notifica al usuario: ya se le avisó al resolver, con la ventana', async () => {
      const ticket = await resolvedHaceDias(20);
      await prisma.notification.deleteMany({});

      await schedule.runTicketAutoClose(AHORA);

      expect(await prisma.notification.count()).toBe(0);
      expect((await leer(ticket.id)).status).toBe('CLOSED');
    });
  });

  // ===========================================================================
  // Lote
  // ===========================================================================

  describe('varios tickets a la vez', () => {
    it('cierra solo los vencidos y deja intactos los demás', async () => {
      const vencidos = [await resolvedHaceDias(15), await resolvedHaceDias(40)];
      const dentro = await resolvedHaceDias(2);
      const abierto = await tickets.createByUser(userId, { subject: 'Vivo', body: 'B' });

      const res = await schedule.runTicketAutoClose(AHORA);

      expect(res.candidates).toBe(2);
      expect(res.closed).toBe(2);
      for (const t of vencidos) expect((await leer(t.id)).status).toBe('CLOSED');
      expect((await leer(dentro.id)).status).toBe('RESOLVED');
      expect((await leer(abierto.id)).status).toBe('OPEN');
    });
  });
});
