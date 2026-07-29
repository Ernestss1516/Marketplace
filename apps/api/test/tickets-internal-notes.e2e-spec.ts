import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { RedisService } from 'src/infra/redis/redis.service';
import { QUEUE_NOTIFICATIONS } from 'src/infra/queue/queue.constants';

/**
 * NOTAS INTERNAS — activación de la escritura (§10.3 / §14.3).
 *
 * LA FUNCIONALIDAD DE MÁXIMO RIESGO DEL SISTEMA: `TicketMessage.internal` guarda
 * lo que el equipo escribe SOBRE un usuario, y filtrarlo se lo enseñaría a él.
 *
 * Las cinco defensas existen desde R1-R4 y ya se probaron con notas SEMBRADAS EN
 * BD. Esta suite las vuelve a probar TODAS con notas creadas por el ENDPOINT
 * REAL: es la única forma de saber que la vía de escritura recién abierta pasa
 * por los mismos filtros y no por un atajo.
 *
 * Se entra por HTTP en las dos direcciones (staff escribe / usuario lee) porque
 * lo que se verifica es el payload EXACTO que sale por el cable.
 */
describe('Tickets — notas internas: escritura real y las 5 defensas', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let addSpy: jest.SpyInstance;

  const PASSWORD = 'Test1234!';
  /** Cadena inconfundible: si aparece en cualquier payload de usuario, hay fuga. */
  const SECRETO = 'NOTA-INTERNA-SOSPECHOSO-DE-FRAUDE-a91f';

  let alice: { id: string; token: string };
  let admin: { id: string; token: string };
  let moderator: { id: string; token: string };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    server = app.getHttpServer();
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
    const client = app.get(RedisService).client;
    const keys = [...(await client.keys('tickets:create:user:*')), ...(await client.keys('auth:*'))];
    if (keys.length) await client.del(...keys);

    alice = await createAndLogin('USER');
    admin = await createAndLogin('ADMIN');
    moderator = await createAndLogin('MODERATOR');
  });

  // --- helpers -------------------------------------------------------------

  async function createUser(role: Role) {
    const id = randomUUID().slice(0, 8);
    return prisma.user.create({
      data: {
        email: `tkn-${id}@test.local`,
        name: `Tkn ${id}`,
        slug: `tkn-${id}`,
        role,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        emailVerified: true,
      },
    });
  }

  async function createAndLogin(role: Role) {
    const user = await createUser(role);
    const path = role === 'ADMIN' ? '/api/auth/admin-login' : '/api/auth/login';
    const res = await request(server)
      .post(path)
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const token = res.body.accessToken as string | undefined;
    if (!token) throw new Error(`Login de ${role} sin accessToken`);
    return { id: user.id, token };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function abrirTicket(): Promise<string> {
    const res = await request(server)
      .post('/api/tickets')
      .set(auth(alice.token))
      .send({ subject: 'Necesito ayuda', body: 'Cuéntame qué hago' })
      .expect(201);
    return res.body.id as string;
  }

  /** Crea una nota interna POR LA VÍA REAL (no sembrada en BD). */
  function escribirNota(ticketId: string, token: string, body = SECRETO) {
    return request(server)
      .post(`/api/admin/tickets/${ticketId}/messages`)
      .set(auth(token))
      .send({ body, internal: true });
  }

  const jobs = () => addSpy.mock.calls.map((c) => c[0] as string);

  // ===========================================================================
  // La escritura, que es lo nuevo
  // ===========================================================================

  describe('escritura de la nota', () => {
    it('el staff crea una nota interna y se persiste internal=true, side=STAFF', async () => {
      const ticketId = await abrirTicket();

      const res = await escribirNota(ticketId, admin.token).expect(201);

      expect(res.body.message.internal).toBe(true);
      expect(res.body.message.side).toBe('STAFF');

      const enBd = await prisma.ticketMessage.findUniqueOrThrow({
        where: { id: res.body.message.id },
      });
      expect(enBd.internal).toBe(true);
      expect(enBd.side).toBe('STAFF');
      expect(enBd.authorId).toBe(admin.id);
    });

    it('sin `internal` (o con false) sigue siendo una respuesta normal', async () => {
      const ticketId = await abrirTicket();

      const sinCampo = await request(server)
        .post(`/api/admin/tickets/${ticketId}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Respuesta normal' })
        .expect(201);
      expect(sinCampo.body.message.internal).toBe(false);

      const conFalse = await request(server)
        .post(`/api/admin/tickets/${ticketId}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Otra normal', internal: false })
        .expect(201);
      expect(conFalse.body.message.internal).toBe(false);
    });

    it('valida el tipo: `internal` no booleano → 400', async () => {
      const ticketId = await abrirTicket();
      await request(server)
        .post(`/api/admin/tickets/${ticketId}/messages`)
        .set(auth(admin.token))
        .send({ body: 'x', internal: 'sí' })
        .expect(400);
    });
  });

  // ===========================================================================
  // DEFENSA 1 — el hilo del usuario no sirve la nota
  // ===========================================================================

  describe('DEFENSA 1: getForUser filtra internal en la query', () => {
    it('EL TEST CRÍTICO — la nota, creada por el endpoint real, NO está en el JSON servido al usuario', async () => {
      const ticketId = await abrirTicket();
      await escribirNota(ticketId, admin.token).expect(201);
      // Y una respuesta normal, para que el hilo no esté vacío y se vea que el
      // filtro discrimina en vez de vaciarlo todo.
      await request(server)
        .post(`/api/admin/tickets/${ticketId}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Esto sí lo puedes leer' })
        .expect(201);

      const res = await request(server)
        .get(`/api/tickets/${ticketId}`)
        .set(auth(alice.token))
        .expect(200);

      // Molde listing-phone.e2e-spec.ts: se busca la cadena EN CRUDO en el cuerpo
      // servido, no solo en el campo donde se espera que esté.
      expect(res.text).not.toContain(SECRETO);
      expect(JSON.stringify(res.body)).not.toContain(SECRETO);
      expect(res.body.messages.every((m: { internal: boolean }) => m.internal === false)).toBe(true);
      expect(res.body.messages.map((m: { body: string }) => m.body)).toContain(
        'Esto sí lo puedes leer',
      );
    });

    it('tampoco se cuela paginando el hilo hacia atrás con ?before', async () => {
      const ticketId = await abrirTicket();
      await escribirNota(ticketId, admin.token).expect(201);
      for (let i = 0; i < 4; i++) {
        await request(server)
          .post(`/api/admin/tickets/${ticketId}/messages`)
          .set(auth(admin.token))
          .send({ body: `Mensaje visible ${i}` })
          .expect(201);
      }

      // Se recorre TODO el hilo página a página: la nota no debe aparecer en ninguna.
      let cursor: string | null = null;
      let vueltas = 0;
      do {
        const url: string = `/api/tickets/${ticketId}?limit=2${cursor ? `&before=${cursor}` : ''}`;
        const page = await request(server).get(url).set(auth(alice.token)).expect(200);
        expect(page.text).not.toContain(SECRETO);
        cursor = (page.body as { nextCursor: string | null }).nextCursor;
        vueltas++;
      } while (cursor && vueltas < 10);
    });

    it('la nota tampoco marca readByUserAt: el usuario no la "lee" porque no la ve', async () => {
      const ticketId = await abrirTicket();
      const nota = await escribirNota(ticketId, admin.token).expect(201);

      await request(server).get(`/api/tickets/${ticketId}`).set(auth(alice.token)).expect(200);

      const enBd = await prisma.ticketMessage.findUniqueOrThrow({
        where: { id: nota.body.message.id },
      });
      expect(enBd.readByUserAt).toBeNull();
    });
  });

  // ===========================================================================
  // DEFENSA 2 — el canal lateral del contador
  // ===========================================================================

  describe('DEFENSA 2: el contador de no leídos no cuenta notas internas', () => {
    it('escribir una nota interna NO sube el badge del usuario', async () => {
      const ticketId = await abrirTicket();

      const antes = await request(server).get('/api/tickets').set(auth(alice.token)).expect(200);
      expect(antes.body.items[0].unreadCount).toBe(0);

      await escribirNota(ticketId, admin.token).expect(201);

      const despues = await request(server).get('/api/tickets').set(auth(alice.token)).expect(200);
      // Si subiera a 1, el usuario sabría que el equipo escribió algo que no ve.
      expect(despues.body.items[0].unreadCount).toBe(0);
      expect(JSON.stringify(despues.body)).not.toContain(SECRETO);
    });

    it('una respuesta NORMAL sí lo sube: el contador discrimina, no está roto', async () => {
      const ticketId = await abrirTicket();
      await escribirNota(ticketId, admin.token).expect(201);
      await request(server)
        .post(`/api/admin/tickets/${ticketId}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Respuesta visible' })
        .expect(201);

      const lista = await request(server).get('/api/tickets').set(auth(alice.token)).expect(200);
      expect(lista.body.items[0].unreadCount).toBe(1); // la visible, no la nota
    });
  });

  // ===========================================================================
  // DEFENSA 2-bis — lastMessageAt, el otro campo que el usuario lee
  // ===========================================================================

  describe('la nota interna no mueve `lastMessageAt` (mismo canal lateral, otro campo)', () => {
    it('el "último movimiento" que ve el usuario no cambia al escribir una nota', async () => {
      const ticketId = await abrirTicket();
      const antes = await request(server).get('/api/tickets').set(auth(alice.token)).expect(200);
      const movimientoAntes = antes.body.items[0].lastMessageAt;

      await escribirNota(ticketId, admin.token).expect(201);

      const despues = await request(server).get('/api/tickets').set(auth(alice.token)).expect(200);
      // Si se moviera, el usuario vería actividad fechada sin ningún mensaje
      // nuevo que la explique, y deduciría que hay algo oculto.
      expect(despues.body.items[0].lastMessageAt).toBe(movimientoAntes);
    });
  });

  // ===========================================================================
  // DEFENSA 4 — la vía de usuario sigue cerrada
  // ===========================================================================

  describe('DEFENSA 4: el usuario no puede marcar nada como interno', () => {
    it('POST /tickets/:id/messages con { internal: true } → 400 y nada queda interno', async () => {
      const ticketId = await abrirTicket();

      await request(server)
        .post(`/api/tickets/${ticketId}/messages`)
        .set(auth(alice.token))
        .send({ body: 'intento colar una nota', internal: true })
        .expect(400);

      // Ni al abrir el ticket.
      await request(server)
        .post('/api/tickets')
        .set(auth(alice.token))
        .send({ subject: 'Otro', body: 'Cuerpo', internal: true })
        .expect(400);

      const internos = await prisma.ticketMessage.count({
        where: { internal: true, side: 'USER' },
      });
      expect(internos).toBe(0);
    });

    it('el DTO de usuario y el de staff son clases DISTINTAS: abrir uno no abre el otro', async () => {
      const ticketId = await abrirTicket();

      // La MISMA petición, con el mismo cuerpo, en las dos rutas: staff 201, usuario 400.
      await escribirNota(ticketId, admin.token).expect(201);
      await request(server)
        .post(`/api/tickets/${ticketId}/messages`)
        .set(auth(alice.token))
        .send({ body: SECRETO, internal: true })
        .expect(400);
    });
  });

  // ===========================================================================
  // DEFENSA 5 — los avisos no se disparan
  // ===========================================================================

  describe('DEFENSA 5: una nota interna no dispara ningún aviso', () => {
    it('ni Notification in-app, ni email al usuario, ni fan-out al staff', async () => {
      const ticketId = await abrirTicket();
      await prisma.notification.deleteMany({});
      addSpy.mockClear();

      await escribirNota(ticketId, admin.token).expect(201);

      expect(await prisma.notification.count()).toBe(0);
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('una respuesta NORMAL sí avisa: la defensa discrimina, no está apagada', async () => {
      const ticketId = await abrirTicket();
      await prisma.notification.deleteMany({});
      addSpy.mockClear();

      await request(server)
        .post(`/api/admin/tickets/${ticketId}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Respuesta visible' })
        .expect(201);

      expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(1);
      expect(jobs()).toContain('send-ticket-message');
    });
  });

  // ===========================================================================
  // El staff SÍ la ve — el contraste
  // ===========================================================================

  describe('el staff sí ve la nota (contraste con el usuario)', () => {
    it('GET /admin/tickets/:id la incluye, marcada como interna', async () => {
      const ticketId = await abrirTicket();
      await escribirNota(ticketId, admin.token).expect(201);

      const staffView = await request(server)
        .get(`/api/admin/tickets/${ticketId}`)
        .set(auth(admin.token))
        .expect(200);
      expect(staffView.text).toContain(SECRETO);
      expect(staffView.body.messages.some((m: { internal: boolean }) => m.internal)).toBe(true);

      // El MISMO ticket, por la vía del usuario: no está.
      const userView = await request(server)
        .get(`/api/tickets/${ticketId}`)
        .set(auth(alice.token))
        .expect(200);
      expect(userView.text).not.toContain(SECRETO);
    });
  });

  // ===========================================================================
  // La nota no transiciona el ticket
  // ===========================================================================

  describe('la nota interna no mueve la máquina de estados', () => {
    it('un ticket en WAITING_USER sigue en WAITING_USER tras una nota', async () => {
      const ticketId = await abrirTicket();
      await request(server)
        .post(`/api/admin/tickets/${ticketId}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Te respondo' })
        .expect(201); // → WAITING_USER

      const res = await escribirNota(ticketId, admin.token).expect(201);

      expect(res.body.ticket.status).toBe('WAITING_USER');
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe(
        'WAITING_USER',
      );
    });

    it('un ticket OPEN sin asignar sigue OPEN y SIN ASIGNAR tras una nota', async () => {
      const ticketId = await abrirTicket();

      await escribirNota(ticketId, admin.token).expect(201);

      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
      expect(after.status).toBe('OPEN');
      // Una nota no es hacerse cargo: para eso está `take`.
      expect(after.assignedToId).toBeNull();
    });

    it('la auditoría distingue la nota de una respuesta', async () => {
      const ticketId = await abrirTicket();
      await escribirNota(ticketId, admin.token).expect(201);
      await request(server)
        .post(`/api/admin/tickets/${ticketId}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Respuesta visible' })
        .expect(201);

      const acciones = (
        await prisma.auditLog.findMany({
          where: { resourceType: 'Ticket', resourceId: ticketId },
          orderBy: { createdAt: 'asc' },
        })
      ).map((l) => l.action);
      expect(acciones).toEqual(['TICKET_INTERNAL_NOTE', 'TICKET_REPLY']);
    });
  });

  // ===========================================================================
  // Las puertas de rol de R3 cubren también la nota interna
  // ===========================================================================

  describe('la puerta ADMIN-only cubre la nota interna', () => {
    it('el MODERATOR escribe notas en un ticket normal', async () => {
      const ticketId = await abrirTicket();
      const res = await escribirNota(ticketId, moderator.token).expect(201);
      expect(res.body.message.internal).toBe(true);
    });

    it('pero NO en uno con factura enlazada → 403 (la puerta cubre todos los verbos)', async () => {
      const invoice = await prisma.invoice.create({
        data: {
          origin: 'USER_REQUESTED',
          status: 'ISSUED',
          number: 'F-NOTAS-1',
          userId: alice.id,
          subtotalNet: 10,
          totalTax: 2.1,
          totalGross: 12.1,
        },
      });
      const conFactura = await request(server)
        .post('/api/tickets')
        .set(auth(alice.token))
        .send({ subject: 'Mi factura', body: 'No cuadra', invoiceId: invoice.id })
        .expect(201);

      const res = await escribirNota(conFactura.body.id, moderator.token).expect(403);
      expect(res.body.code).toBe('TICKET_BILLING_ADMIN_ONLY');

      // El ADMIN sí puede: el contraste completo.
      await escribirNota(conFactura.body.id, admin.token).expect(201);
    });

    it('un USER normal no llega ni a la ruta de staff', async () => {
      const ticketId = await abrirTicket();
      await escribirNota(ticketId, alice.token).expect(403);
    });
  });
});
