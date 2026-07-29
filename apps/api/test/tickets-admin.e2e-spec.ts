import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, Report, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { TicketsService } from 'src/modules/tickets/tickets.service';
import { RedisService } from 'src/infra/redis/redis.service';
import { StaffActor } from 'src/modules/tickets/tickets.types';

/**
 * Atención al usuario R3 — API de STAFF, ejercida por HTTP.
 *
 * Las fronteras de rol se ejercen como ATAQUES (molde RR5.1): no basta con ver
 * el 403 del que no puede — hay que ver el 200 del que sí, o el contraste podría
 * ser un 401 por token vacío disfrazado de autorización correcta.
 *
 * Y se vigila el requisito de oro del flujo (c): `Report` NO SE TOCA. Hay
 * aserciones que comparan la fila entera del reporte antes y después.
 */
describe('Tickets — API de staff (R3) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let tickets: TicketsService;

  const PASSWORD = 'Test1234!';

  let admin: { id: string; token: string };
  let moderator: { id: string; token: string };
  let otherModerator: { id: string; token: string };
  let alice: { id: string; token: string };
  let bob: { id: string; token: string };
  let adminActor: StaffActor;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    server = app.getHttpServer();
    tickets = app.get(TicketsService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    await flushTicketRateLimit();
    admin = await createAndLogin('ADMIN');
    moderator = await createAndLogin('MODERATOR');
    otherModerator = await createAndLogin('MODERATOR');
    alice = await createAndLogin('USER');
    bob = await createAndLogin('USER');
    adminActor = { userId: admin.id, role: 'ADMIN' };
  });

  // --- helpers -------------------------------------------------------------

  async function createUser(role: Role) {
    const id = randomUUID().slice(0, 8);
    return prisma.user.create({
      data: {
        email: `tka-${id}@test.local`,
        name: `Tka ${id}`,
        slug: `tka-${id}`,
        role,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        emailVerified: true,
      },
    });
  }

  /**
   * SANITY-CHECK DEL TOKEN (lección de R5 de facturación, para no repetirla):
   * un ADMIN **no** puede entrar por `/auth/login` — ese endpoint lo rechaza con
   * 403 `ADMIN_MUST_USE_ADMIN_LOGIN` y devolvería `accessToken: undefined`. Con
   * un token vacío, TODA ruta da 401 y un test de permisos "pasaría" por el
   * motivo equivocado. Por eso el ADMIN va por `/auth/admin-login` y aquí se
   * comprueba explícitamente que el token existe.
   */
  async function createAndLogin(role: Role) {
    const user = await createUser(role);
    const path = role === 'ADMIN' ? '/api/auth/admin-login' : '/api/auth/login';
    const res = await request(server)
      .post(path)
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const token = res.body.accessToken as string | undefined;
    if (!token) throw new Error(`Login de ${role} no devolvió accessToken — revisa la ruta usada`);
    return { id: user.id, token };
  }

  /**
   * Limpia los contadores de rate limit ANTES DE CADA TEST.
   *
   * `auth:*` es imprescindible aquí, no una precaución: esta suite crea y
   * loguea 5 usuarios por test, y `/auth/admin-login` tiene un límite por IP
   * MÁS ESTRICTO que el público (es la puerta del panel). Desde localhost todos
   * los logins comparten IP, así que sin este flush la suite se estrangula a sí
   * misma a mitad de camino y los fallos aparecen como 429 en el `beforeEach` —
   * ruido de infraestructura disfrazado de fallo de producto.
   *
   * Mismo principio que `reset-redis-between-suites.ts`, que ya hace esto entre
   * ARCHIVOS por la misma razón; aquí hace falta con grano más fino porque una
   * sola suite ya agota la ventana. El rate limit sigue probado donde toca
   * (`auth-security.e2e-spec.ts`), que es quien lo tiene por objeto.
   */
  async function flushTicketRateLimit() {
    const client = app.get(RedisService).client;
    const keys = await client.keys('tickets:create:user:*');
    const authKeys = await client.keys('auth:*');
    const todas = [...keys, ...authKeys];
    if (todas.length) await client.del(...todas);
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Ticket abierto por un usuario (flujo a), vía servicio para no gastar el rate limit. */
  function userTicket(userId: string, subject = 'Duda', extra: Record<string, unknown> = {}) {
    return tickets.createByUser(userId, { subject, body: 'Cuerpo', ...extra });
  }

  async function seedInvoice(userId: string, number = 'F-2026-001') {
    return prisma.invoice.create({
      data: {
        origin: 'USER_REQUESTED',
        status: 'ISSUED',
        number,
        userId,
        subtotalNet: 10,
        totalTax: 2.1,
        totalGross: 12.1,
      },
    });
  }

  async function seedListing(sellerId: string, title = 'Bici') {
    const category = await prisma.category.findFirstOrThrow();
    return prisma.listing.create({
      data: {
        title,
        slug: `l-${randomUUID().slice(0, 8)}`,
        description: 'd',
        price: 100,
        type: 'PRODUCT',
        sellerId,
        categoryId: category.id,
      },
    });
  }

  // ===========================================================================
  // Sanity-check del propio andamiaje del test
  // ===========================================================================

  describe('sanity-check de los tokens (para que el contraste 403 vs 200 sea real)', () => {
    it('el ADMIN entra por /auth/admin-login y su token FUNCIONA en la ruta', async () => {
      await request(server).get('/api/admin/tickets').set(auth(admin.token)).expect(200);
    });

    it('/auth/login RECHAZA a un ADMIN — por eso no se usa aquí', async () => {
      const adminUser = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
      const res = await request(server)
        .post('/api/auth/login')
        .send({ email: adminUser.email, password: PASSWORD })
        .expect(403);
      expect(res.body.code).toBe('ADMIN_MUST_USE_ADMIN_LOGIN');
    });

    it('el MODERATOR entra por /auth/login y su token FUNCIONA en la ruta', async () => {
      await request(server).get('/api/admin/tickets').set(auth(moderator.token)).expect(200);
    });
  });

  // ===========================================================================
  // Fronteras de rol de la ruta (RolesGuard)
  // ===========================================================================

  describe('fronteras de rol de la ruta', () => {
    it('un USER normal no entra en ninguna ruta de staff → 403', async () => {
      const t = await userTicket(alice.id);
      await request(server).get('/api/admin/tickets').set(auth(alice.token)).expect(403);
      await request(server).get(`/api/admin/tickets/${t.id}`).set(auth(alice.token)).expect(403);
      await request(server).post(`/api/admin/tickets/${t.id}/take`).set(auth(alice.token)).expect(403);
      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .send({ body: 'x' })
        .expect(403);
      await request(server).post(`/api/admin/tickets/${t.id}/resolve`).set(auth(alice.token)).expect(403);
      await request(server).post(`/api/admin/tickets/${t.id}/close`).set(auth(alice.token)).expect(403);
    });

    it('sin autenticación → 401', async () => {
      await request(server).get('/api/admin/tickets').expect(401);
    });

    it('el MODERATOR SÍ puede el ciclo completo: bandeja, tomar, responder, resolver, cerrar', async () => {
      const t = await userTicket(alice.id);

      await request(server).get('/api/admin/tickets').set(auth(moderator.token)).expect(200);
      await request(server).get(`/api/admin/tickets/${t.id}`).set(auth(moderator.token)).expect(200);
      await request(server).post(`/api/admin/tickets/${t.id}/take`).set(auth(moderator.token)).expect(200);
      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(moderator.token))
        .send({ body: 'Te respondo' })
        .expect(201);
      await request(server).post(`/api/admin/tickets/${t.id}/resolve`).set(auth(moderator.token)).expect(200);
      await request(server).post(`/api/admin/tickets/${t.id}/close`).set(auth(moderator.token)).expect(200);
    });
  });

  // ===========================================================================
  // ATAQUE 1 — puerta ADMIN-only por CONTENIDO: tickets con factura
  // ===========================================================================

  describe('ATAQUE: ticket con factura enlazada (ADMIN-only por contenido de fila)', () => {
    async function ticketConFactura() {
      const invoice = await seedInvoice(alice.id, 'F-2026-SECRETA');
      return userTicket(alice.id, 'Mi factura no cuadra', { invoiceId: invoice.id });
    }

    it('el MODERATOR NO puede abrirlo (403) pero el ADMIN SÍ (200) — el contraste completo', async () => {
      const t = await ticketConFactura();

      const negado = await request(server)
        .get(`/api/admin/tickets/${t.id}`)
        .set(auth(moderator.token))
        .expect(403);
      expect(negado.body.code).toBe('TICKET_BILLING_ADMIN_ONLY');

      await request(server).get(`/api/admin/tickets/${t.id}`).set(auth(admin.token)).expect(200);
    });

    it('el MODERATOR tampoco lo VE en la bandeja; el ADMIN sí', async () => {
      const conFactura = await ticketConFactura();
      const normal = await userTicket(bob.id, 'Duda normal');

      const bandejaMod = await request(server)
        .get('/api/admin/tickets')
        .set(auth(moderator.token))
        .expect(200);
      const bandejaAdmin = await request(server)
        .get('/api/admin/tickets')
        .set(auth(admin.token))
        .expect(200);

      const idsMod = bandejaMod.body.items.map((t: { id: string }) => t.id);
      expect(idsMod).toContain(normal.id);
      expect(idsMod).not.toContain(conFactura.id);
      expect(bandejaMod.body.total).toBe(1);
      // Ni el asunto ni el número de factura asoman por el listado.
      expect(JSON.stringify(bandejaMod.body)).not.toContain('F-2026-SECRETA');
      expect(JSON.stringify(bandejaMod.body)).not.toContain('Mi factura no cuadra');

      expect(bandejaAdmin.body.items.map((t: { id: string }) => t.id)).toEqual(
        expect.arrayContaining([conFactura.id, normal.id]),
      );
    });

    it('la puerta cubre TODOS los verbos, no solo ver y responder', async () => {
      const t = await ticketConFactura();
      await tickets.take(t.id, adminActor); // el ADMIN lo pone IN_PROGRESS

      // Un MODERATOR que pudiera resolver o cerrar lo que no puede LEER estaría
      // cerrando a ciegas una reclamación de facturación.
      for (const verbo of ['take', 'resolve', 'close', 'reassign']) {
        const req = request(server)
          .post(`/api/admin/tickets/${t.id}/${verbo}`)
          .set(auth(moderator.token));
        const res = await (verbo === 'reassign' ? req.send({ assignedToId: moderator.id }) : req);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('TICKET_BILLING_ADMIN_ONLY');
      }
      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(moderator.token))
        .send({ body: 'intento responder' })
        .expect(403);

      // Y el ticket sigue exactamente donde estaba.
      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      expect(after.status).toBe('IN_PROGRESS');
      expect(await prisma.ticketMessage.count({ where: { ticketId: t.id } })).toBe(1);
    });
  });

  // ===========================================================================
  // ATAQUE 2 — puerta ADMIN-only: reasignar el ticket de otro agente
  // ===========================================================================

  describe('ATAQUE: reasignar el ticket de OTRO agente (ADMIN-only)', () => {
    it('el MODERATOR no puede quitarle el ticket a otro agente (403); el ADMIN sí (200)', async () => {
      const t = await userTicket(alice.id);
      // Lo toma el OTRO moderador: ahora es suyo.
      await tickets.take(t.id, { userId: otherModerator.id, role: 'MODERATOR' });

      const negado = await request(server)
        .post(`/api/admin/tickets/${t.id}/reassign`)
        .set(auth(moderator.token))
        .send({ assignedToId: moderator.id })
        .expect(403);
      expect(negado.body.code).toBe('TICKET_REASSIGN_ADMIN_ONLY');
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).assignedToId).toBe(
        otherModerator.id,
      );

      await request(server)
        .post(`/api/admin/tickets/${t.id}/reassign`)
        .set(auth(admin.token))
        .send({ assignedToId: moderator.id })
        .expect(200);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).assignedToId).toBe(
        moderator.id,
      );
    });

    it('el MODERATOR SÍ puede asignarse uno SIN ASIGNAR y mover el SUYO', async () => {
      const sinAsignar = await userTicket(alice.id, 'Sin dueño');
      await request(server)
        .post(`/api/admin/tickets/${sinAsignar.id}/reassign`)
        .set(auth(moderator.token))
        .send({ assignedToId: moderator.id })
        .expect(200);

      // Ahora es suyo: puede pasárselo a un compañero.
      await request(server)
        .post(`/api/admin/tickets/${sinAsignar.id}/reassign`)
        .set(auth(moderator.token))
        .send({ assignedToId: otherModerator.id })
        .expect(200);
    });

    it('no se puede asignar a alguien que no es staff (quedaría inalcanzable)', async () => {
      const t = await userTicket(alice.id);
      const res = await request(server)
        .post(`/api/admin/tickets/${t.id}/reassign`)
        .set(auth(admin.token))
        .send({ assignedToId: alice.id })
        .expect(422);
      expect(res.body.code).toBe('ASSIGNEE_NOT_STAFF');
    });
  });

  // ===========================================================================
  // Bandeja y filtros
  // ===========================================================================

  describe('GET /admin/tickets — bandeja', () => {
    it('lista tickets de VARIOS usuarios con su dueño y el resumen', async () => {
      await userTicket(alice.id, 'De Alice');
      await userTicket(bob.id, 'De Bob');

      const res = await request(server).get('/api/admin/tickets').set(auth(admin.token)).expect(200);

      expect(res.body.total).toBe(2);
      const asuntos = res.body.items.map((t: { subject: string }) => t.subject);
      expect(asuntos).toEqual(expect.arrayContaining(['De Alice', 'De Bob']));
      expect(res.body.items[0].user).toHaveProperty('name');
      expect(res.body.items[0]).toHaveProperty('unreadFromUser');
    });

    it('filtra por status, origin, topic y agente (me / none)', async () => {
      const topic = await prisma.contactReason.create({
        data: { nombre: 'Facturación', scope: 'TICKET' },
      });
      const abierto = await userTicket(alice.id, 'Abierto');
      const enCurso = await userTicket(bob.id, 'En curso', { topicId: topic.id });
      await tickets.take(enCurso.id, adminActor);
      const deStaff = await tickets.createByStaff(adminActor, {
        userId: alice.id,
        subject: 'Iniciado por admin',
        body: 'Hola',
        origin: 'ADMIN',
      });

      const porStatus = await request(server)
        .get('/api/admin/tickets?status=OPEN')
        .set(auth(admin.token))
        .expect(200);
      expect(porStatus.body.items.map((t: { id: string }) => t.id)).toEqual([abierto.id]);

      const porOrigin = await request(server)
        .get('/api/admin/tickets?origin=ADMIN')
        .set(auth(admin.token))
        .expect(200);
      expect(porOrigin.body.items.map((t: { id: string }) => t.id)).toEqual([deStaff.id]);

      const porTopic = await request(server)
        .get(`/api/admin/tickets?topicId=${topic.id}`)
        .set(auth(admin.token))
        .expect(200);
      expect(porTopic.body.items.map((t: { id: string }) => t.id)).toEqual([enCurso.id]);

      const mios = await request(server)
        .get('/api/admin/tickets?assignedTo=me')
        .set(auth(admin.token))
        .expect(200);
      expect(mios.body.items.map((t: { id: string }) => t.id).sort()).toEqual(
        [enCurso.id, deStaff.id].sort(),
      );

      const sinAsignar = await request(server)
        .get('/api/admin/tickets?assignedTo=none')
        .set(auth(admin.token))
        .expect(200);
      expect(sinAsignar.body.items.map((t: { id: string }) => t.id)).toEqual([abierto.id]);
    });

    it('ordena por último movimiento descendente', async () => {
      const viejo = await userTicket(alice.id, 'Viejo');
      const nuevo = await userTicket(bob.id, 'Nuevo');
      await tickets.replyAsStaff(viejo.id, adminActor, 'lo muevo al frente');

      const res = await request(server).get('/api/admin/tickets').set(auth(admin.token)).expect(200);
      expect(res.body.items.map((t: { id: string }) => t.id)).toEqual([viejo.id, nuevo.id]);
    });
  });

  // ===========================================================================
  // Transiciones y AuditLog
  // ===========================================================================

  describe('transiciones de staff', () => {
    const auditFor = (ticketId: string) =>
      prisma.auditLog.findMany({
        where: { resourceType: 'Ticket', resourceId: ticketId },
        orderBy: { createdAt: 'asc' },
      });

    it('take → resolve → close, con su AuditLog y sin TICKET_REOPEN', async () => {
      const t = await userTicket(alice.id);

      await request(server).post(`/api/admin/tickets/${t.id}/take`).set(auth(admin.token)).expect(200);
      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Respuesta oficial' })
        .expect(201);
      await request(server).post(`/api/admin/tickets/${t.id}/resolve`).set(auth(admin.token)).expect(200);
      await request(server).post(`/api/admin/tickets/${t.id}/close`).set(auth(admin.token)).expect(200);

      const acciones = (await auditFor(t.id)).map((l) => l.action);
      expect(acciones).toEqual([
        'TICKET_ASSIGN',
        'TICKET_REPLY',
        'TICKET_RESOLVE',
        'TICKET_CLOSE',
      ]);
      expect(acciones).not.toContain('TICKET_REOPEN');
    });

    it('respeta los guards: resolve sobre OPEN → 400; take sobre uno ya tomado → 400', async () => {
      const t = await userTicket(alice.id);
      await request(server).post(`/api/admin/tickets/${t.id}/resolve`).set(auth(admin.token)).expect(400);

      await request(server).post(`/api/admin/tickets/${t.id}/take`).set(auth(admin.token)).expect(200);
      await request(server).post(`/api/admin/tickets/${t.id}/take`).set(auth(admin.token)).expect(400);
    });

    it('responder como staff congela side=STAFF e internal=false, y pasa a WAITING_USER', async () => {
      const t = await userTicket(alice.id);

      const res = await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(moderator.token))
        .send({ body: 'Respondo yo' })
        .expect(201);

      expect(res.body.ticket.status).toBe('WAITING_USER');
      expect(res.body.ticket.assignedToId).toBe(moderator.id); // T4: responder asigna
      expect(res.body.message.side).toBe('STAFF');
      expect(res.body.message.internal).toBe(false);
    });

    /**
     * PREMISA INVERTIDA A PROPÓSITO (ráfaga de notas internas).
     *
     * Cuando se escribió, en R3, este test afirmaba que el DTO de staff NO
     * aceptaba `internal` — porque las notas internas estaban aplazadas (§14.3).
     * Abrir esa vía era justamente el objetivo de la ráfaga posterior, así que la
     * afirmación de entonces ya no describe el sistema.
     *
     * Se conserva lo que seguía siendo valioso —que la puerta del USUARIO sigue
     * cerrada— y se actualiza lo que cambió. Mismo criterio que los 3 tests que
     * pasaron de 403 a 200 en RR5.1-ext: cambio de producto deliberado, no
     * regresión. La cobertura a fondo de las 5 defensas vive en
     * `tickets-internal-notes.e2e-spec.ts`.
     */
    it('el DTO de staff SÍ acepta internal (nota interna); el de usuario sigue sin aceptarlo', async () => {
      const t = await userTicket(alice.id);

      // Staff: la vía abierta.
      const staffRes = await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'nota para el equipo', internal: true })
        .expect(201);
      expect(staffRes.body.message.internal).toBe(true);

      // Usuario: la misma petición, rechazada. El campo no existe en su DTO.
      await request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .send({ body: 'intento colar una nota', internal: true })
        .expect(400);

      // Y ningún mensaje del lado USUARIO quedó marcado como interno.
      expect(await prisma.ticketMessage.count({ where: { internal: true, side: 'USER' } })).toBe(0);
    });

    it('sobre un CLOSED todo se rechaza (irreversibilidad, también por HTTP)', async () => {
      const t = await userTicket(alice.id);
      await request(server).post(`/api/admin/tickets/${t.id}/close`).set(auth(admin.token)).expect(200);

      await request(server).post(`/api/admin/tickets/${t.id}/take`).set(auth(admin.token)).expect(400);
      await request(server).post(`/api/admin/tickets/${t.id}/resolve`).set(auth(admin.token)).expect(400);
      await request(server).post(`/api/admin/tickets/${t.id}/close`).set(auth(admin.token)).expect(400);
      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'x' })
        .expect(400);
    });
  });

  // ===========================================================================
  // getForStaff ve las notas internas — contraste con getForUser (R2)
  // ===========================================================================

  describe('notas internas: el staff SÍ las ve, el usuario NO', () => {
    const SECRETO = 'NOTA-INTERNA-SOLO-STAFF-4c8e';

    it('mismo ticket: aparece en /admin/tickets/:id y NO en /tickets/:id', async () => {
      const t = await userTicket(alice.id);
      // Sin vía de escritura en la app (aplazada, §14.3): se siembra en BD.
      await prisma.ticketMessage.create({
        data: { ticketId: t.id, authorId: admin.id, side: 'STAFF', body: SECRETO, internal: true },
      });

      const vistaStaff = await request(server)
        .get(`/api/admin/tickets/${t.id}`)
        .set(auth(admin.token))
        .expect(200);
      expect(JSON.stringify(vistaStaff.body)).toContain(SECRETO);

      const vistaUsuario = await request(server)
        .get(`/api/tickets/${t.id}`)
        .set(auth(alice.token))
        .expect(200);
      expect(JSON.stringify(vistaUsuario.body)).not.toContain(SECRETO);
    });

    it('abrir el hilo marca como leídos los mensajes del USUARIO (acuse del lado staff)', async () => {
      const t = await userTicket(alice.id);
      const propio = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: t.id } });
      expect(propio.readByStaffAt).toBeNull();

      await request(server).get(`/api/admin/tickets/${t.id}`).set(auth(admin.token)).expect(200);

      const after = await prisma.ticketMessage.findUniqueOrThrow({ where: { id: propio.id } });
      expect(after.readByStaffAt).not.toBeNull();
    });
  });

  // ===========================================================================
  // FLUJO (b) — admin → usuario
  // ===========================================================================

  describe('FLUJO (b): POST /admin/tickets', () => {
    it('abre el hilo: origin=ADMIN, WAITING_USER, asignado al actor, y el usuario lo ve en LOS SUYOS', async () => {
      const res = await request(server)
        .post('/api/admin/tickets')
        .set(auth(moderator.token))
        .send({ userId: alice.id, subject: 'Revisión de tu cuenta', body: 'Confirma un dato' })
        .expect(201);

      expect(res.body).toMatchObject({
        origin: 'ADMIN',
        status: 'WAITING_USER',
        userId: alice.id,
        openedById: moderator.id,
        assignedToId: moderator.id,
      });

      // El owner-scope de R2 lo incluye sin cambios: es SU ticket aunque no lo abriera él.
      const mios = await request(server).get('/api/tickets').set(auth(alice.token)).expect(200);
      expect(mios.body.items.map((t: { id: string }) => t.id)).toContain(res.body.id);
      expect(mios.body.items[0].unreadCount).toBe(1); // el mensaje del staff, sin leer
    });

    it('valida los enlaces contra el USUARIO DESTINATARIO, no contra el agente', async () => {
      const facturaDeBob = await seedInvoice(bob.id, 'F-DE-BOB');

      // Enlazar la factura de Bob en un hilo de Alice le filtraría el dato a ella.
      const res = await request(server)
        .post('/api/admin/tickets')
        .set(auth(admin.token))
        .send({ userId: alice.id, subject: 'Sobre tu factura', body: 'x', invoiceId: facturaDeBob.id })
        .expect(422);
      expect(res.body.code).toBe('LINKED_ENTITY_NOT_ALLOWED');

      // La misma factura, en el hilo de SU dueño, sí vale.
      const ok = await request(server)
        .post('/api/admin/tickets')
        .set(auth(admin.token))
        .send({ userId: bob.id, subject: 'Sobre tu factura', body: 'x', invoiceId: facturaDeBob.id })
        .expect(201);
      expect(ok.body.linkedLabel).toBe('Factura F-DE-BOB');
    });

    it('el MODERATOR también puede abrir el flujo (b)', async () => {
      await request(server)
        .post('/api/admin/tickets')
        .set(auth(moderator.token))
        .send({ userId: bob.id, subject: 'Aviso', body: 'Hola' })
        .expect(201);
    });
  });

  // ===========================================================================
  // FLUJO (c) — desde un Report. REQUISITO DE ORO: Report NO SE TOCA.
  // ===========================================================================

  describe('FLUJO (c): POST /admin/tickets/from-report/:reportId', () => {
    async function seedReport(data: Partial<Report> = {}) {
      return prisma.report.create({
        data: {
          reason: 'SPAM',
          reporterId: bob.id,
          reportedUserId: alice.id,
          ...(data as object),
        },
      });
    }

    it('crea el ticket con origin=REPORT y reportId, y deja el Report INTACTO', async () => {
      const report = await seedReport();
      const antes = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });

      const res = await request(server)
        .post(`/api/admin/tickets/from-report/${report.id}`)
        .set(auth(moderator.token))
        .send({ subject: 'Sobre una denuncia', body: 'Nos han reportado tu anuncio' })
        .expect(201);

      expect(res.body).toMatchObject({
        origin: 'REPORT',
        reportId: report.id,
        userId: alice.id, // el usuario REPORTADO
        status: 'WAITING_USER',
        assignedToId: moderator.id,
      });

      // Fila entera igual: ni estado, ni resolvedBy, ni nada.
      const despues = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
      expect(despues).toEqual(antes);
      expect(despues.status).toBe('PENDING');
    });

    it('el DESTINATARIO lo resuelve el SERVIDOR — el body no puede elegirlo', async () => {
      const report = await seedReport();

      // El DTO no declara userId → forbidNonWhitelisted lo rechaza en vez de
      // ignorarlo. Falla ruidosamente, que es mejor que en silencio.
      await request(server)
        .post(`/api/admin/tickets/from-report/${report.id}`)
        .set(auth(admin.token))
        .send({ subject: 'Sobre tu denuncia', body: 'Cuerpo del aviso', userId: bob.id })
        .expect(400);

      expect(await prisma.ticket.count()).toBe(0);

      // Y por la vía legítima, el destinatario es el del REPORTE, no quien denuncia.
      const ok = await request(server)
        .post(`/api/admin/tickets/from-report/${report.id}`)
        .set(auth(admin.token))
        .send({ subject: 'Sobre tu denuncia', body: 'Cuerpo del aviso' })
        .expect(201);
      expect(ok.body.userId).toBe(alice.id);
      expect(ok.body.userId).not.toBe(bob.id);
    });

    it('resuelve el destinatario por el VENDEDOR del anuncio cuando no hay reportedUserId', async () => {
      const listing = await seedListing(alice.id);
      const report = await prisma.report.create({
        data: { reason: 'PROHIBITED_ITEM', reporterId: bob.id, listingId: listing.id },
      });

      const res = await request(server)
        .post(`/api/admin/tickets/from-report/${report.id}`)
        .set(auth(admin.token))
        .send({ subject: 'Sobre tu anuncio', body: 'x' })
        .expect(201);

      expect(res.body.userId).toBe(alice.id);
    });

    it('resuelve por el AUTOR de la valoración reportada', async () => {
      const review = await prisma.review.create({
        data: { rating: 1, authorId: alice.id, targetId: bob.id, listingTitle: 'Algo' },
      });
      const report = await prisma.report.create({
        data: { reason: 'FAKE_REVIEW', reporterId: bob.id, reviewId: review.id },
      });

      const res = await request(server)
        .post(`/api/admin/tickets/from-report/${report.id}`)
        .set(auth(admin.token))
        .send({ subject: 'Sobre tu valoración', body: 'x' })
        .expect(201);

      expect(res.body.userId).toBe(alice.id); // el AUTOR de la reseña
    });

    it('reporte inexistente → 404', async () => {
      await request(server)
        .post('/api/admin/tickets/from-report/no-existe')
        .set(auth(admin.token))
        .send({ subject: 'Sobre tu denuncia', body: 'Cuerpo del aviso' })
        .expect(404);
    });

    it('cerrar el ticket NO toca el Report: son acciones independientes', async () => {
      const report = await seedReport();
      const antes = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });

      const t = await request(server)
        .post(`/api/admin/tickets/from-report/${report.id}`)
        .set(auth(admin.token))
        .send({ subject: 'Sobre tu denuncia', body: 'Cuerpo del aviso' })
        .expect(201);

      await request(server).post(`/api/admin/tickets/${t.body.id}/close`).set(auth(admin.token)).expect(200);

      expect(await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).toEqual(antes);
    });

    it('resolver el Report por la vía de moderación NO toca el ticket: la otra dirección', async () => {
      const report = await seedReport();
      const t = await request(server)
        .post(`/api/admin/tickets/from-report/${report.id}`)
        .set(auth(admin.token))
        .send({ subject: 'Sobre tu denuncia', body: 'Cuerpo del aviso' })
        .expect(201);

      // La cola de moderación sigue siendo la dueña del ciclo de vida del Report.
      await request(server)
        .patch(`/api/moderation/reports/${report.id}/resolve`)
        .set(auth(admin.token))
        .expect(200);

      expect((await prisma.report.findUniqueOrThrow({ where: { id: report.id } })).status).toBe(
        'RESOLVED',
      );
      // El hilo sigue vivo: el usuario aún puede responder.
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.body.id } })).status).toBe(
        'WAITING_USER',
      );
    });
  });
});
