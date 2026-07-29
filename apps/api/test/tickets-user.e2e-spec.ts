import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { TicketsService } from 'src/modules/tickets/tickets.service';
import { RedisService } from 'src/infra/redis/redis.service';
import { TICKET_CREATE_LIMIT_PER_DAY, TICKET_REOPEN_WINDOW_DAYS } from 'src/modules/tickets/tickets.constants';

/**
 * Atención al usuario R2 — API de USUARIO, ejercida por HTTP.
 *
 * A diferencia de R1 (que probaba la máquina de estados por la capa de servicio),
 * aquí se entra por la red: es la única forma de ejercer lo que R2 realmente
 * añade — guards, `ValidationPipe` con `whitelist`/`forbidNonWhitelisted`,
 * owner-scope sobre parámetros que vienen del cliente, y el payload EXACTO que se
 * sirve (el test de privacidad busca en el JSON servido, no en un objeto de
 * memoria).
 *
 * Los caminos malos se ejercen como ATAQUES, no como casos límite: el oráculo de
 * ids ajenos, el ticket de otro, y el intento de colar `internal: true`.
 */
describe('Tickets — API de usuario (R2) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let tickets: TicketsService;

  const PASSWORD = 'Test1234!';

  let alice: { id: string; token: string };
  let bob: { id: string; token: string };
  let staffId: string;

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
    alice = await createUserAndLogin('USER');
    bob = await createUserAndLogin('USER');
    staffId = (await createUser('ADMIN')).id;
  });

  // --- helpers -------------------------------------------------------------

  async function createUser(role: Role) {
    const id = randomUUID().slice(0, 8);
    return prisma.user.create({
      data: {
        email: `tku-${id}@test.local`,
        name: `Tku ${id}`,
        slug: `tku-${id}`,
        role,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        emailVerified: true,
      },
    });
  }

  async function createUserAndLogin(role: Role) {
    const user = await createUser(role);
    const res = await request(server)
      .post('/api/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    return { id: user.id, token: res.body.accessToken as string };
  }

  /**
   * El contador del rate limit vive en Redis y NO lo toca `cleanDb` (que solo
   * trunca tablas). Sin esto, la suite de rate limit envenenaría a las que
   * corren después — mismo principio que el flush de `auth:*` entre suites.
   */
  async function flushTicketRateLimit() {
    const client = app.get(RedisService).client;
    const keys = await client.keys('tickets:create:user:*');
    if (keys.length) await client.del(...keys);
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Devuelve el `Test` de supertest (no una Promise ya resuelta) para poder encadenar `.expect()`. */
  function openTicket(token: string, body: Record<string, unknown> = {}) {
    return request(server)
      .post('/api/tickets')
      .set(auth(token))
      .send({ subject: 'Necesito ayuda', body: 'No consigo hacer X', ...body });
  }

  async function seedCategory() {
    return prisma.category.findFirstOrThrow();
  }

  async function seedListing(sellerId: string, title = 'Bici de montaña') {
    const category = await seedCategory();
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

  async function seedReview(authorId: string, targetId: string) {
    return prisma.review.create({
      data: { rating: 4, authorId, targetId, listingTitle: 'Mesa de roble' },
    });
  }

  // ===========================================================================
  // POST /tickets — creación
  // ===========================================================================

  describe('POST /tickets', () => {
    it('crea el ticket sin entidad enlazada: OPEN, origin USER, primer mensaje side USER', async () => {
      const res = await openTicket(alice.token).expect(201);

      expect(res.body).toMatchObject({
        status: 'OPEN',
        origin: 'USER',
        userId: alice.id,
        openedById: alice.id,
        linkedLabel: null,
      });

      const msgs = await prisma.ticketMessage.findMany({ where: { ticketId: res.body.id } });
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toMatchObject({ side: 'USER', authorId: alice.id, internal: false });
    });

    it('enlaza un anuncio PROPIO y congela linkedLabel con el título real', async () => {
      const listing = await seedListing(alice.id, 'Bici de montaña Orbea');

      const res = await openTicket(alice.token, { listingId: listing.id }).expect(201);

      expect(res.body.listingId).toBe(listing.id);
      expect(res.body.linkedLabel).toBe('Bici de montaña Orbea');
    });

    it('enlaza una factura PROPIA y una valoración RECIBIDA', async () => {
      const invoice = await seedInvoice(alice.id, 'F-2026-777');
      const resInv = await openTicket(alice.token, { invoiceId: invoice.id }).expect(201);
      expect(resInv.body.invoiceId).toBe(invoice.id);
      expect(resInv.body.linkedLabel).toBe('Factura F-2026-777');

      // Valoración que BOB escribió sobre ALICE: Alice es el receptor y también
      // tiene derecho a preguntar por ella.
      const review = await seedReview(bob.id, alice.id);
      const resRev = await openTicket(alice.token, { reviewId: review.id }).expect(201);
      expect(resRev.body.reviewId).toBe(review.id);
      expect(resRev.body.linkedLabel).toContain('Valoración 4');
    });

    it('rechaza enlazar DOS entidades a la vez (linkedLabel sería ambiguo)', async () => {
      const listing = await seedListing(alice.id);
      const invoice = await seedInvoice(alice.id);

      const res = await openTicket(alice.token, {
        listingId: listing.id,
        invoiceId: invoice.id,
      }).expect(422);

      expect(res.body.code).toBe('MULTIPLE_LINKED_ENTITIES');
    });

    it('rechaza un topicId de scope PUBLIC, inactivo o inexistente; acepta TICKET y BOTH', async () => {
      const publico = await prisma.contactReason.create({
        data: { nombre: 'Solo web', scope: 'PUBLIC' },
      });
      const inactivo = await prisma.contactReason.create({
        data: { nombre: 'Retirado', scope: 'TICKET', activo: false },
      });
      const soloTicket = await prisma.contactReason.create({
        data: { nombre: 'Mi factura', scope: 'TICKET' },
      });
      const ambos = await prisma.contactReason.create({
        data: { nombre: 'Otro', scope: 'BOTH' },
      });

      await openTicket(alice.token, { topicId: publico.id }).expect(400);
      await openTicket(alice.token, { topicId: inactivo.id }).expect(400);
      await openTicket(alice.token, { topicId: 'no-existe' }).expect(400);
      await openTicket(alice.token, { topicId: soloTicket.id }).expect(201);
      await openTicket(alice.token, { topicId: ambos.id }).expect(201);
    });

    it('exige autenticación', async () => {
      await request(server).post('/api/tickets').send({ subject: 'x', body: 'y' }).expect(401);
    });

    it('rechaza campos que el servidor decide (origin, userId, status, linkedLabel)', async () => {
      // whitelist + forbidNonWhitelisted: no están en el DTO → 400, sin llegar al servicio.
      for (const intruso of [
        { origin: 'ADMIN' },
        { userId: bob.id },
        { status: 'CLOSED' },
        { linkedLabel: 'Mentira' },
        { openedById: staffId },
      ]) {
        await openTicket(alice.token, intruso).expect(400);
      }
    });
  });

  // ===========================================================================
  // ATAQUE 1 — el oráculo de ids ajenos
  // ===========================================================================

  describe('ATAQUE: oráculo de existencia por la entidad enlazada', () => {
    it('enlazar una factura AJENA se rechaza IGUAL que una inexistente, sin filtrar existencia', async () => {
      const facturaDeBob = await seedInvoice(bob.id, 'F-2026-BOB');

      const ajena = await openTicket(alice.token, { invoiceId: facturaDeBob.id });
      const inexistente = await openTicket(alice.token, { invoiceId: 'cl00000000000000000000000' });

      // LA PRUEBA: mismo status y misma respuesta EXACTA en los dos casos. Si
      // difirieran (404 vs 403, o mensajes distintos), Alice podría sondear ids
      // ajenos y distinguir "existe" de "no existe".
      expect(ajena.status).toBe(422);
      expect(inexistente.status).toBe(422);
      expect(ajena.body).toEqual(inexistente.body);
      expect(ajena.body.code).toBe('LINKED_ENTITY_NOT_ALLOWED');

      // Y no se filtra el número de la factura de Bob por ningún resquicio.
      expect(JSON.stringify(ajena.body)).not.toContain('F-2026-BOB');
      expect(JSON.stringify(ajena.body)).not.toContain(facturaDeBob.id);
    });

    it('mismo trato para un anuncio ajeno y para una valoración en la que no participa', async () => {
      const anuncioDeBob = await seedListing(bob.id, 'Portátil de Bob');
      const reviewAjena = await seedReview(bob.id, staffId); // ni autora ni receptora

      const l1 = await openTicket(alice.token, { listingId: anuncioDeBob.id });
      const l2 = await openTicket(alice.token, { listingId: 'no-existe' });
      const r1 = await openTicket(alice.token, { reviewId: reviewAjena.id });
      const r2 = await openTicket(alice.token, { reviewId: 'no-existe' });

      for (const res of [l1, l2, r1, r2]) {
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('LINKED_ENTITY_NOT_ALLOWED');
      }
      expect(l1.body).toEqual(l2.body);
      expect(r1.body).toEqual(r2.body);
      expect(JSON.stringify(l1.body)).not.toContain('Portátil de Bob');
    });

    it('ningún intento fallido deja un ticket a medias en la BD', async () => {
      const facturaDeBob = await seedInvoice(bob.id);
      await openTicket(alice.token, { invoiceId: facturaDeBob.id }).expect(422);

      expect(await prisma.ticket.count()).toBe(0);
      expect(await prisma.ticketMessage.count()).toBe(0);
    });
  });

  // ===========================================================================
  // GET /tickets y GET /tickets/:id — owner-scope
  // ===========================================================================

  describe('GET /tickets — owner-scope', () => {
    it('cada usuario ve SOLO los suyos', async () => {
      const a1 = await openTicket(alice.token, { subject: 'De Alice 1' });
      const a2 = await openTicket(alice.token, { subject: 'De Alice 2' });
      const b1 = await openTicket(bob.token, { subject: 'De Bob' });

      const listaAlice = await request(server).get('/api/tickets').set(auth(alice.token)).expect(200);
      const listaBob = await request(server).get('/api/tickets').set(auth(bob.token)).expect(200);

      expect(listaAlice.body.total).toBe(2);
      expect(listaAlice.body.items.map((t: { id: string }) => t.id).sort()).toEqual(
        [a1.body.id, a2.body.id].sort(),
      );
      expect(listaBob.body.total).toBe(1);
      expect(listaBob.body.items[0].id).toBe(b1.body.id);
      // El ticket de Bob no asoma por ningún lado en la respuesta de Alice.
      expect(JSON.stringify(listaAlice.body)).not.toContain('De Bob');
    });

    it('GET /tickets/:id de otro usuario → 403', async () => {
      const deBob = await openTicket(bob.token);
      await request(server).get(`/api/tickets/${deBob.body.id}`).set(auth(alice.token)).expect(403);
    });

    it('POST message y POST close sobre un ticket ajeno → 403', async () => {
      const deBob = await openTicket(bob.token);
      await request(server)
        .post(`/api/tickets/${deBob.body.id}/messages`)
        .set(auth(alice.token))
        .send({ body: 'me cuelo' })
        .expect(403);
      await request(server)
        .post(`/api/tickets/${deBob.body.id}/close`)
        .set(auth(alice.token))
        .expect(403);
    });

    it('GET /tickets/:id inexistente → 404', async () => {
      await request(server).get('/api/tickets/no-existe').set(auth(alice.token)).expect(404);
    });

    it('unreadCount cuenta los mensajes del staff sin leer', async () => {
      const t = await openTicket(alice.token);
      await tickets.replyAsStaff(t.body.id, staffId, 'Respuesta 1');
      await tickets.replyAsStaff(t.body.id, staffId, 'Respuesta 2');

      const lista = await request(server).get('/api/tickets').set(auth(alice.token)).expect(200);
      expect(lista.body.items[0].unreadCount).toBe(2);
    });
  });

  // ===========================================================================
  // ATAQUE 2 — el test de privacidad de las notas internas (§10.3.4)
  // ===========================================================================

  describe('ATAQUE: fuga de notas internas', () => {
    const SECRETO = 'NOTA-INTERNA-SOSPECHOSO-DE-FRAUDE-7b21';

    /**
     * Las notas internas están APLAZADAS (§14.3): no hay vía de escritura ni en
     * el servicio ni en ningún DTO. Se siembra la fila DIRECTAMENTE en BD para
     * poder ejercer el filtro hoy — la defensa se pone ANTES de que exista el
     * dato (lección de Listing.phone).
     */
    async function seedInternalNote(ticketId: string) {
      return prisma.ticketMessage.create({
        data: { ticketId, authorId: staffId, side: 'STAFF', body: SECRETO, internal: true },
      });
    }

    it('GET /tickets/:id NO sirve la nota interna — búsqueda de la cadena EN CRUDO en el JSON', async () => {
      const t = await openTicket(alice.token);
      await seedInternalNote(t.body.id);
      await tickets.replyAsStaff(t.body.id, staffId, 'Esto sí lo puedes leer');

      const res = await request(server)
        .get(`/api/tickets/${t.body.id}`)
        .set(auth(alice.token))
        .expect(200);

      // Molde listing-phone.e2e-spec.ts: no basta con mirar el campo esperado —
      // se busca el secreto en el cuerpo servido, tal cual sale por el cable.
      expect(JSON.stringify(res.body)).not.toContain(SECRETO);
      expect(res.text).not.toContain(SECRETO);
      expect(res.body.messages.every((m: { internal: boolean }) => m.internal === false)).toBe(true);
      expect(res.body.messages.map((m: { body: string }) => m.body)).toContain(
        'Esto sí lo puedes leer',
      );
    });

    it('la nota interna tampoco se filtra por el CONTADOR de no leídos (canal lateral)', async () => {
      const t = await openTicket(alice.token);
      await seedInternalNote(t.body.id);

      const lista = await request(server).get('/api/tickets').set(auth(alice.token)).expect(200);

      // Si contara, Alice sabría que el staff escribió algo que no puede ver.
      expect(lista.body.items[0].unreadCount).toBe(0);
      expect(JSON.stringify(lista.body)).not.toContain(SECRETO);
    });

    it('el usuario no puede CREAR una nota interna: { internal: true } en el body → 400', async () => {
      const t = await openTicket(alice.token);

      await request(server)
        .post(`/api/tickets/${t.body.id}/messages`)
        .set(auth(alice.token))
        .send({ body: 'intento colar una nota', internal: true })
        .expect(400); // forbidNonWhitelisted — el campo no existe en el DTO

      // Y al crear el ticket tampoco.
      await openTicket(alice.token, { internal: true }).expect(400);

      // Nada quedó marcado como interno en BD.
      expect(await prisma.ticketMessage.count({ where: { internal: true } })).toBe(0);
    });

    it('un mensaje creado por la vía legítima queda internal=false en BD', async () => {
      const t = await openTicket(alice.token);
      await request(server)
        .post(`/api/tickets/${t.body.id}/messages`)
        .set(auth(alice.token))
        .send({ body: 'mensaje normal' })
        .expect(201);

      const msgs = await prisma.ticketMessage.findMany({ where: { ticketId: t.body.id } });
      expect(msgs).toHaveLength(2);
      expect(msgs.every((m) => m.internal === false)).toBe(true);
    });
  });

  // ===========================================================================
  // POST /tickets/:id/messages — transiciones
  // ===========================================================================

  describe('POST /tickets/:id/messages', () => {
    it('T5: WAITING_USER → IN_PROGRESS', async () => {
      const t = await openTicket(alice.token);
      await tickets.replyAsStaff(t.body.id, staffId, 'Te leo'); // → WAITING_USER

      const res = await request(server)
        .post(`/api/tickets/${t.body.id}/messages`)
        .set(auth(alice.token))
        .send({ body: 'Ahí va la respuesta' })
        .expect(201);

      expect(res.body.ticket.status).toBe('IN_PROGRESS');
      expect(res.body.message.side).toBe('USER');
    });

    it('T6: OPEN sigue OPEN, pero lastMessageAt avanza', async () => {
      const t = await openTicket(alice.token);

      const res = await request(server)
        .post(`/api/tickets/${t.body.id}/messages`)
        .set(auth(alice.token))
        .send({ body: 'Se me olvidaba' })
        .expect(201);

      expect(res.body.ticket.status).toBe('OPEN');
      expect(new Date(res.body.ticket.lastMessageAt).getTime()).toBeGreaterThan(
        new Date(t.body.lastMessageAt).getTime(),
      );
    });

    it('T8: reabre un RESOLVED DENTRO de la ventana → IN_PROGRESS y limpia resolvedAt', async () => {
      const t = await openTicket(alice.token);
      await tickets.take(t.body.id, staffId);
      await tickets.resolve(t.body.id, staffId);

      const res = await request(server)
        .post(`/api/tickets/${t.body.id}/messages`)
        .set(auth(alice.token))
        .send({ body: 'Sigue sin funcionar' })
        .expect(201);

      expect(res.body.ticket.status).toBe('IN_PROGRESS');
      expect(res.body.ticket.resolvedAt).toBeNull();
    });

    it('T8: FUERA de la ventana de 14 días → 400 y el ticket sigue RESOLVED', async () => {
      const t = await openTicket(alice.token);
      await tickets.take(t.body.id, staffId);
      await tickets.resolve(t.body.id, staffId);

      // Se envejece resolvedAt un día más allá del plazo.
      const vencido = new Date(Date.now() - (TICKET_REOPEN_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
      await prisma.ticket.update({ where: { id: t.body.id }, data: { resolvedAt: vencido } });

      const res = await request(server)
        .post(`/api/tickets/${t.body.id}/messages`)
        .set(auth(alice.token))
        .send({ body: 'Tarde' })
        .expect(400);

      expect(res.body.code).toBe('REOPEN_WINDOW_EXPIRED');
      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t.body.id } });
      expect(after.status).toBe('RESOLVED');
      // Y el mensaje NO se escribió: sigue solo el de apertura.
      expect(await prisma.ticketMessage.count({ where: { ticketId: t.body.id } })).toBe(1);
    });

    it('responder sobre un CLOSED → 400', async () => {
      const t = await openTicket(alice.token);
      await request(server).post(`/api/tickets/${t.body.id}/close`).set(auth(alice.token)).expect(200);

      await request(server)
        .post(`/api/tickets/${t.body.id}/messages`)
        .set(auth(alice.token))
        .send({ body: 'ya no' })
        .expect(400);
    });

    it('valida el body (vacío y demasiado largo)', async () => {
      const t = await openTicket(alice.token);
      const url = `/api/tickets/${t.body.id}/messages`;
      await request(server).post(url).set(auth(alice.token)).send({ body: '' }).expect(400);
      await request(server).post(url).set(auth(alice.token)).send({ body: 'x'.repeat(5001) }).expect(400);
    });
  });

  // ===========================================================================
  // POST /tickets/:id/close — T11
  // ===========================================================================

  describe('POST /tickets/:id/close', () => {
    it('cierra el propio (origin=USER) y el cierre es irreversible', async () => {
      const t = await openTicket(alice.token);

      const res = await request(server)
        .post(`/api/tickets/${t.body.id}/close`)
        .set(auth(alice.token))
        .expect(200);

      expect(res.body.status).toBe('CLOSED');
      expect(res.body.closedById).toBe(alice.id);

      // Segunda vez → 400 (CLOSED no está en CLOSABLE).
      await request(server).post(`/api/tickets/${t.body.id}/close`).set(auth(alice.token)).expect(400);
    });

    it('NO puede cerrar un hilo abierto por la administración (origin=ADMIN) → 403', async () => {
      const t = await tickets.createByStaff(staffId, {
        userId: alice.id,
        subject: 'Revisión',
        body: 'Hola',
        origin: 'ADMIN',
      });

      await request(server).post(`/api/tickets/${t.id}/close`).set(auth(alice.token)).expect(403);

      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      expect(after.status).toBe('WAITING_USER');
    });
  });

  // ===========================================================================
  // Acuse de lectura
  // ===========================================================================

  describe('acuse de lectura', () => {
    it('marca readByUserAt en los mensajes del staff al abrir el hilo, y es idempotente', async () => {
      const t = await openTicket(alice.token);
      const { message } = await tickets.replyAsStaff(t.body.id, staffId, 'Respuesta');

      expect((await prisma.ticketMessage.findUniqueOrThrow({ where: { id: message.id } })).readByUserAt).toBeNull();

      await request(server).get(`/api/tickets/${t.body.id}`).set(auth(alice.token)).expect(200);
      const primera = await prisma.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
      expect(primera.readByUserAt).not.toBeNull();

      await request(server).get(`/api/tickets/${t.body.id}`).set(auth(alice.token)).expect(200);
      const segunda = await prisma.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
      // Idempotente: el `readByUserAt: null` del where impide re-sellar la fecha.
      expect(segunda.readByUserAt).toEqual(primera.readByUserAt);
    });

    it('NO marca como leídos los mensajes del propio usuario', async () => {
      const t = await openTicket(alice.token);
      await request(server).get(`/api/tickets/${t.body.id}`).set(auth(alice.token)).expect(200);

      const propio = await prisma.ticketMessage.findFirstOrThrow({
        where: { ticketId: t.body.id, side: 'USER' },
      });
      expect(propio.readByUserAt).toBeNull();
    });

    it('abrir un hilo ajeno (403) no marca nada como leído', async () => {
      const t = await openTicket(bob.token);
      const { message } = await tickets.replyAsStaff(t.body.id, staffId, 'Para Bob');

      await request(server).get(`/api/tickets/${t.body.id}`).set(auth(alice.token)).expect(403);

      const after = await prisma.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
      expect(after.readByUserAt).toBeNull();
    });
  });

  // ===========================================================================
  // Paginación del hilo
  // ===========================================================================

  describe('paginación del hilo (cursor)', () => {
    it('devuelve los más recientes primero y pagina hacia atrás con ?before', async () => {
      const t = await openTicket(alice.token, { body: 'mensaje 0' });
      for (let i = 1; i <= 4; i++) {
        await request(server)
          .post(`/api/tickets/${t.body.id}/messages`)
          .set(auth(alice.token))
          .send({ body: `mensaje ${i}` })
          .expect(201);
      }

      const p1 = await request(server)
        .get(`/api/tickets/${t.body.id}?limit=2`)
        .set(auth(alice.token))
        .expect(200);

      expect(p1.body.messages.map((m: { body: string }) => m.body)).toEqual(['mensaje 4', 'mensaje 3']);
      expect(p1.body.nextCursor).not.toBeNull();

      const p2 = await request(server)
        .get(`/api/tickets/${t.body.id}?limit=2&before=${p1.body.nextCursor}`)
        .set(auth(alice.token))
        .expect(200);

      expect(p2.body.messages.map((m: { body: string }) => m.body)).toEqual(['mensaje 2', 'mensaje 1']);

      const p3 = await request(server)
        .get(`/api/tickets/${t.body.id}?limit=2&before=${p2.body.nextCursor}`)
        .set(auth(alice.token))
        .expect(200);

      expect(p3.body.messages.map((m: { body: string }) => m.body)).toEqual(['mensaje 0']);
      expect(p3.body.nextCursor).toBeNull();
    });

    it('un cursor de OTRO hilo se ignora (no desplaza la ventana)', async () => {
      const mio = await openTicket(alice.token, { body: 'mio' });
      const otro = await openTicket(alice.token, { body: 'otro' });
      const msgOtro = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: otro.body.id } });

      const res = await request(server)
        .get(`/api/tickets/${mio.body.id}?before=${msgOtro.id}`)
        .set(auth(alice.token))
        .expect(200);

      expect(res.body.messages.map((m: { body: string }) => m.body)).toEqual(['mio']);
    });
  });

  // ===========================================================================
  // Rate limit
  // ===========================================================================

  describe('rate limit de apertura', () => {
    it(`permite ${TICKET_CREATE_LIMIT_PER_DAY} tickets al día y rechaza el siguiente con 429`, async () => {
      for (let i = 0; i < TICKET_CREATE_LIMIT_PER_DAY; i++) {
        await openTicket(alice.token, { subject: `Ticket ${i}` }).expect(201);
      }

      const res = await openTicket(alice.token, { subject: 'El que sobra' }).expect(429);
      expect(res.body.code).toBe('TICKET_RATE_LIMIT');
      expect(res.body.retryAfter).toBeGreaterThan(0);

      // El contador es POR USUARIO: a Bob no le afecta.
      await openTicket(bob.token).expect(201);
      expect(await prisma.ticket.count({ where: { userId: alice.id } })).toBe(
        TICKET_CREATE_LIMIT_PER_DAY,
      );
    });
  });
});
