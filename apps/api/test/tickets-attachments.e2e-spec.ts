import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { TicketsService } from 'src/modules/tickets/tickets.service';
import { TicketAttachmentsService } from 'src/modules/tickets/ticket-attachments.service';
import { RedisService } from 'src/infra/redis/redis.service';
import { R2Service } from 'src/infra/r2/r2.service';
import { StaffActor } from 'src/modules/tickets/tickets.types';

/**
 * Atención al usuario R5 — ADJUNTOS, ejercidos por HTTP contra R2 de verdad
 * (MinIO en local): se sube, se baja y se compara el byte a byte. Nada de mocks
 * en el camino del fichero — un adjunto que no vuelve igual no es un adjunto.
 *
 * LO QUE ESTA SUITE VIGILA, por orden de gravedad:
 *  1. NO EXISTE UNA URL PÚBLICA. Es la diferencia con `media` y la razón de ser
 *     del molde FACTURA.
 *  2. El adjunto de OTRO no se descarga (403), ejercido como ataque.
 *  3. El adjunto de una NOTA INTERNA hereda su privacidad — defensa 6 de §10.3.
 *  4. La clave en R2 no lleva NADA del cliente.
 */
describe('Tickets — adjuntos (R5) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let tickets: TicketsService;
  let r2: R2Service;

  const PASSWORD = 'Test1234!';

  let admin: { id: string; token: string };
  let moderator: { id: string; token: string };
  let alice: { id: string; token: string };
  let bob: { id: string; token: string };

  /** PNG 1×1 real, en memoria (molde media.e2e-spec: sin dependencia del disco). */
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );
  const TINY_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8');

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    server = app.getHttpServer();
    tickets = app.get(TicketsService);
    r2 = app.get(R2Service);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    await flushRateLimits();
    admin = await createAndLogin('ADMIN');
    moderator = await createAndLogin('MODERATOR');
    alice = await createAndLogin('USER');
    bob = await createAndLogin('USER');
  });

  // --- helpers -------------------------------------------------------------

  async function createUser(role: Role) {
    const id = randomUUID().slice(0, 8);
    return prisma.user.create({
      data: {
        email: `tat-${id}@test.local`,
        name: `Tat ${id}`,
        slug: `tat-${id}`,
        role,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        emailVerified: true,
      },
    });
  }

  /** Molde R3: el ADMIN entra por `/auth/admin-login` o el token vendría vacío. */
  async function createAndLogin(role: Role) {
    const user = await createUser(role);
    const path = role === 'ADMIN' ? '/api/auth/admin-login' : '/api/auth/login';
    const res = await request(server)
      .post(path)
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const token = res.body.accessToken as string | undefined;
    if (!token) throw new Error(`Login de ${role} no devolvió accessToken`);
    return { id: user.id, token };
  }

  async function flushRateLimits() {
    const client = app.get(RedisService).client;
    const keys = [
      ...(await client.keys('tickets:create:user:*')),
      ...(await client.keys('auth:*')),
    ];
    if (keys.length) await client.del(...keys);
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const actor = (u: { id: string }, role: 'ADMIN' | 'MODERATOR'): StaffActor => ({
    userId: u.id,
    role,
  });

  function userTicket(userId: string, subject = 'Duda', extra: Record<string, unknown> = {}) {
    return tickets.createByUser(userId, { subject, body: 'Cuerpo', ...extra });
  }

  async function ticketConFactura(userId: string) {
    const invoice = await prisma.invoice.create({
      data: {
        origin: 'USER_REQUESTED',
        status: 'ISSUED',
        number: `F-R5-${randomUUID().slice(0, 6)}`,
        userId,
        subtotalNet: 10,
        totalTax: 2.1,
        totalGross: 12.1,
      },
    });
    return userTicket(userId, 'Mi factura no cuadra', { invoiceId: invoice.id });
  }

  /** Adjuntos de un ticket, con la `key` — que el payload HTTP nunca sirve. */
  function attachmentsOf(ticketId: string) {
    return prisma.ticketAttachment.findMany({
      where: { message: { ticketId } },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ===========================================================================
  // Subida
  // ===========================================================================

  describe('el usuario adjunta a su propio hilo', () => {
    it('un PNG válido → 201 y una fila TicketAttachment con los metadatos', async () => {
      const t = await userTicket(alice.id);

      await request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .field('body', 'Te mando el pantallazo')
        .attach('files', TINY_PNG, { filename: 'pantallazo.png', contentType: 'image/png' })
        .expect(201);

      const [adj] = await attachmentsOf(t.id);
      expect(adj.filename).toBe('pantallazo.png');
      expect(adj.mimeType).toBe('image/png');
      expect(adj.sizeBytes).toBe(TINY_PNG.length);
    });

    it('LA CLAVE DE R2 NO LLEVA NADA DEL CLIENTE (molde MediaService)', async () => {
      const t = await userTicket(alice.id);

      await request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .field('body', 'Mira')
        .attach('files', TINY_PNG, { filename: 'foto secreta.png', contentType: 'image/png' })
        .expect(201);

      const [adj] = await attachmentsOf(t.id);
      // tickets/<ticketId>/<32 hex>.png — y nada más.
      expect(adj.key).toMatch(new RegExp(`^tickets/${t.id}/[0-9a-f]{32}\\.png$`));
      expect(adj.key).not.toContain('secreta');
      expect(adj.key).not.toContain(' ');
      // El nombre original SÍ se guarda, pero en su columna: ahí es un dato, no una ruta.
      expect(adj.filename).toBe('foto secreta.png');
    });

    it('un PDF también vale (§14.7 añade PDF a la whitelist de media)', async () => {
      const t = await userTicket(alice.id);

      await request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .field('body', 'La factura en PDF')
        .attach('files', TINY_PDF, { filename: 'doc.pdf', contentType: 'application/pdf' })
        .expect(201);

      const [adj] = await attachmentsOf(t.id);
      expect(adj.key).toMatch(/\.pdf$/);
    });

    it('los 5 del límite pasan, y el 6º NO (el límite es inclusivo)', async () => {
      const t = await userTicket(alice.id);

      const cinco = request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .field('body', 'Cinco');
      for (let i = 0; i < 5; i++) {
        cinco.attach('files', TINY_PNG, { filename: `f${i}.png`, contentType: 'image/png' });
      }
      await cinco.expect(201);
      expect(await attachmentsOf(t.id)).toHaveLength(5);

      const seis = request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .field('body', 'Seis');
      for (let i = 0; i < 6; i++) {
        seis.attach('files', TINY_PNG, { filename: `g${i}.png`, contentType: 'image/png' });
      }
      const res = await seis.expect(422);
      expect(res.body.code).toBe('TOO_MANY_ATTACHMENTS');
      // Y no se ha colado ninguno del lote rechazado.
      expect(await attachmentsOf(t.id)).toHaveLength(5);
    });

    it('un tipo fuera de la whitelist → 422 y NI SE SUBE a R2', async () => {
      const t = await userTicket(alice.id);
      const subir = jest.spyOn(r2, 'upload');

      try {
        const res = await request(server)
          .post(`/api/tickets/${t.id}/messages`)
          .set(auth(alice.token))
          .field('body', 'Toma un .txt')
          .attach('files', Buffer.from('no soy una imagen'), {
            filename: 'notas.txt',
            contentType: 'text/plain',
          })
          .expect(422);

        expect(res.body.code).toBe('ATTACHMENT_TYPE_NOT_ALLOWED');
        // Se valida TODO antes de subir NADA: el bucket no se toca.
        expect(subir).not.toHaveBeenCalled();
      } finally {
        subir.mockRestore();
      }
    });

    it('más de 10 MB → 422', async () => {
      const t = await userTicket(alice.id);
      const gordo = Buffer.alloc(10 * 1024 * 1024 + 1024, 1);

      const res = await request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .field('body', 'Un fichero enorme')
        .attach('files', gordo, { filename: 'grande.png', contentType: 'image/png' })
        .expect(422);

      expect(res.body.code).toBe('ATTACHMENT_TOO_LARGE');
      expect(await attachmentsOf(t.id)).toHaveLength(0);
    });

    it('un lote con UNO inválido no sube NINGUNO (validar todo antes de subir nada)', async () => {
      const t = await userTicket(alice.id);
      const subir = jest.spyOn(r2, 'upload');

      try {
        await request(server)
          .post(`/api/tickets/${t.id}/messages`)
          .set(auth(alice.token))
          .field('body', 'Dos buenos y uno malo')
          .attach('files', TINY_PNG, { filename: 'ok1.png', contentType: 'image/png' })
          .attach('files', TINY_PNG, { filename: 'ok2.png', contentType: 'image/png' })
          .attach('files', Buffer.from('x'), { filename: 'malo.txt', contentType: 'text/plain' })
          .expect(422);

        expect(subir).not.toHaveBeenCalled();
        expect(await attachmentsOf(t.id)).toHaveLength(0);
      } finally {
        subir.mockRestore();
      }
    });

    it('REGRESIÓN: responder en JSON sigue funcionando exactamente igual', async () => {
      const t = await userTicket(alice.id);

      const res = await request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .send({ body: 'Sin adjuntos, como siempre' })
        .expect(201);

      expect(res.body.message.body).toBe('Sin adjuntos, como siempre');
      expect(await attachmentsOf(t.id)).toHaveLength(0);
    });
  });

  // ===========================================================================
  // ATAQUE: subir a un hilo ajeno
  // ===========================================================================

  describe('ATAQUE: adjuntar a un hilo que no es tuyo', () => {
    it('403 y NO se escribe un solo byte en R2 (autorizar va ANTES de subir)', async () => {
      const t = await userTicket(alice.id);
      const subir = jest.spyOn(r2, 'upload');

      try {
        await request(server)
          .post(`/api/tickets/${t.id}/messages`)
          .set(auth(bob.token))
          .field('body', 'Me cuelo')
          .attach('files', TINY_PNG, { filename: 'x.png', contentType: 'image/png' })
          .expect(403);

        // Si el orden fuera "subir y luego autorizar", el endpoint sería
        // almacenamiento gratuito escribible por cualquiera con un id ajeno.
        expect(subir).not.toHaveBeenCalled();
      } finally {
        subir.mockRestore();
      }
    });
  });

  // ===========================================================================
  // Descarga
  // ===========================================================================

  describe('descarga autenticada', () => {
    async function conAdjunto(userId: string, token: string, filename = 'mio.png') {
      const t = await userTicket(userId);
      await request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(token))
        .field('body', 'Ahí va')
        .attach('files', TINY_PNG, { filename, contentType: 'image/png' })
        .expect(201);
      const [adj] = await attachmentsOf(t.id);
      return { ticketId: t.id, adj };
    }

    it('el dueño lo baja: 200, MISMOS BYTES y Content-Disposition con el nombre original', async () => {
      const { ticketId, adj } = await conAdjunto(alice.id, alice.token, 'informe final.png');

      const res = await request(server)
        .get(`/api/tickets/${ticketId}/attachments/${adj.id}`)
        .set(auth(alice.token))
        .expect(200);

      expect(Buffer.compare(res.body as Buffer, TINY_PNG)).toBe(0);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('informe final.png');
    });

    it('ATAQUE — el adjunto de OTRO usuario → 403', async () => {
      const { ticketId, adj } = await conAdjunto(alice.id, alice.token);

      await request(server)
        .get(`/api/tickets/${ticketId}/attachments/${adj.id}`)
        .set(auth(bob.token))
        .expect(403);
    });

    it('ATAQUE — id de adjunto ajeno colgado de MI propio ticket → 404', async () => {
      // Sin comprobar que el adjunto es de ESTE ticket, el control de propiedad
      // miraría mi ticket y devolvería el fichero de otro.
      const ajeno = await conAdjunto(alice.id, alice.token, 'de-alice.png');
      const mio = await userTicket(bob.id);

      await request(server)
        .get(`/api/tickets/${mio.id}/attachments/${ajeno.adj.id}`)
        .set(auth(bob.token))
        .expect(404);
    });

    it('sin token → 401 (no hay ninguna vía anónima al fichero)', async () => {
      const { ticketId, adj } = await conAdjunto(alice.id, alice.token);
      await request(server).get(`/api/tickets/${ticketId}/attachments/${adj.id}`).expect(401);
    });

    it('un adjunto que no existe → 404', async () => {
      const t = await userTicket(alice.id);
      await request(server)
        .get(`/api/tickets/${t.id}/attachments/noexiste`)
        .set(auth(alice.token))
        .expect(404);
    });

    it('el usuario SÍ baja lo que le adjunta el staff en una respuesta normal', async () => {
      const t = await userTicket(alice.id);
      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .field('body', 'Te adjunto el justificante')
        .attach('files', TINY_PDF, { filename: 'justificante.pdf', contentType: 'application/pdf' })
        .expect(201);

      const [adj] = await attachmentsOf(t.id);
      await request(server)
        .get(`/api/tickets/${t.id}/attachments/${adj.id}`)
        .set(auth(alice.token))
        .expect(200);
    });
  });

  // ===========================================================================
  // NO HAY URL PÚBLICA — la invariante que define el molde
  // ===========================================================================

  describe('NO hay URL pública en ninguna parte (contraste con media)', () => {
    it('el payload del hilo trae metadatos e id, pero NI la key NI ninguna url', async () => {
      const t = await userTicket(alice.id);
      await request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .field('body', 'Adjunto')
        .attach('files', TINY_PNG, { filename: 'a.png', contentType: 'image/png' })
        .expect(201);

      const [adj] = await attachmentsOf(t.id);
      const hilo = await request(server)
        .get(`/api/tickets/${t.id}`)
        .set(auth(alice.token))
        .expect(200);

      const conAdjuntos = (hilo.body.messages as { attachments?: unknown[] }[]).filter(
        (m) => (m.attachments?.length ?? 0) > 0,
      );
      expect(conAdjuntos).toHaveLength(1);
      const servido = (conAdjuntos[0].attachments as Record<string, unknown>[])[0];
      expect(servido.id).toBe(adj.id);
      expect(servido.filename).toBe('a.png');
      // Lo que NO viaja:
      expect(servido).not.toHaveProperty('key');
      expect(servido).not.toHaveProperty('url');

      const crudo = JSON.stringify(hilo.body);
      expect(crudo).not.toContain(adj.key);
      // `media` devuelve `url: <publicUrl>/media/...`; aquí no hay nada parecido.
      expect(crudo).not.toContain('/tickets/' + t.id + '/' + adj.key);
      expect(crudo).not.toMatch(/https?:\/\/[^"]*tickets\/[0-9a-f]{32}/);
    });

    it('el hilo de staff tampoco sirve la key', async () => {
      const t = await userTicket(alice.id);
      await request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .field('body', 'Adjunto')
        .attach('files', TINY_PNG, { filename: 'b.png', contentType: 'image/png' })
        .expect(201);
      const [adj] = await attachmentsOf(t.id);

      const hilo = await request(server)
        .get(`/api/admin/tickets/${t.id}`)
        .set(auth(admin.token))
        .expect(200);

      expect(JSON.stringify(hilo.body)).not.toContain(adj.key);
    });
  });

  // ===========================================================================
  // DEFENSA 6 — el adjunto de una nota interna hereda su privacidad
  // ===========================================================================

  describe('ADJUNTO DE NOTA INTERNA — la invariante §10.3 extendida a los ficheros', () => {
    async function notaInternaConAdjunto(ticketId: string) {
      await request(server)
        .post(`/api/admin/tickets/${ticketId}/messages`)
        .set(auth(admin.token))
        .field('body', 'Ojo con este usuario: reincidente')
        .field('internal', 'true')
        .attach('files', TINY_PDF, { filename: 'historial-interno.pdf', contentType: 'application/pdf' })
        .expect(201);

      const adj = await prisma.ticketAttachment.findFirstOrThrow({
        where: { message: { ticketId, internal: true } },
      });
      return adj;
    }

    it('la nota se crea con su adjunto y `internal` sobrevive al multipart', async () => {
      const t = await userTicket(alice.id);
      const adj = await notaInternaConAdjunto(t.id);

      const mensaje = await prisma.ticketMessage.findFirstOrThrow({
        where: { ticketId: t.id, internal: true },
      });
      expect(mensaje.side).toBe('STAFF');
      expect(adj.filename).toBe('historial-interno.pdf');
    });

    it('EL USUARIO NO PUEDE DESCARGARLO → 404, como si no existiera', async () => {
      const t = await userTicket(alice.id);
      const adj = await notaInternaConAdjunto(t.id);

      // 404 y no 403: un 403 confirmaría que ahí hay algo, y la EXISTENCIA de una
      // nota interna es justo lo que el usuario no puede llegar a saber.
      await request(server)
        .get(`/api/tickets/${t.id}/attachments/${adj.id}`)
        .set(auth(alice.token))
        .expect(404);
    });

    it('el usuario tampoco ve la nota ni su adjunto en el hilo', async () => {
      const t = await userTicket(alice.id);
      const adj = await notaInternaConAdjunto(t.id);

      const hilo = await request(server)
        .get(`/api/tickets/${t.id}`)
        .set(auth(alice.token))
        .expect(200);

      const crudo = JSON.stringify(hilo.body);
      expect(crudo).not.toContain('reincidente');
      expect(crudo).not.toContain('historial-interno.pdf');
      expect(crudo).not.toContain(adj.id);
    });

    it('el STAFF sí lo descarga (es su destinatario) — el contraste completo', async () => {
      const t = await userTicket(alice.id);
      const adj = await notaInternaConAdjunto(t.id);

      const res = await request(server)
        .get(`/api/admin/tickets/${t.id}/attachments/${adj.id}`)
        .set(auth(admin.token))
        .expect(200);

      expect(Buffer.compare(res.body as Buffer, TINY_PDF)).toBe(0);
    });

    it('una nota interna con adjunto sigue sin tocar el ticket (ni estado ni lastMessageAt)', async () => {
      const t = await userTicket(alice.id);
      const antes = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });

      await notaInternaConAdjunto(t.id);

      const despues = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      expect(despues.status).toBe(antes.status);
      expect(despues.lastMessageAt).toEqual(antes.lastMessageAt);
    });
  });

  // ===========================================================================
  // Puerta ADMIN-only de facturación, aplicada a los ficheros
  // ===========================================================================

  describe('ticket con factura enlazada: los adjuntos también son ADMIN-only', () => {
    it('el MODERATOR no puede ADJUNTAR (403) y el ADMIN sí (201)', async () => {
      const t = await ticketConFactura(alice.id);
      const subir = jest.spyOn(r2, 'upload');

      try {
        const negado = await request(server)
          .post(`/api/admin/tickets/${t.id}/messages`)
          .set(auth(moderator.token))
          .field('body', 'Intento')
          .attach('files', TINY_PNG, { filename: 'x.png', contentType: 'image/png' })
          .expect(403);
        expect(negado.body.code).toBe('TICKET_BILLING_ADMIN_ONLY');
        expect(subir).not.toHaveBeenCalled();
      } finally {
        subir.mockRestore();
      }

      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .field('body', 'Yo sí')
        .attach('files', TINY_PNG, { filename: 'ok.png', contentType: 'image/png' })
        .expect(201);
    });

    it('el MODERATOR no puede DESCARGAR (403) y el ADMIN sí (200)', async () => {
      const t = await ticketConFactura(alice.id);
      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .field('body', 'Justificante')
        .attach('files', TINY_PDF, { filename: 'f.pdf', contentType: 'application/pdf' })
        .expect(201);
      const [adj] = await attachmentsOf(t.id);

      const negado = await request(server)
        .get(`/api/admin/tickets/${t.id}/attachments/${adj.id}`)
        .set(auth(moderator.token))
        .expect(403);
      expect(negado.body.code).toBe('TICKET_BILLING_ADMIN_ONLY');

      await request(server)
        .get(`/api/admin/tickets/${t.id}/attachments/${adj.id}`)
        .set(auth(admin.token))
        .expect(200);
    });

    it('y el DUEÑO del ticket con factura sí baja lo suyo (la puerta es de staff, no del usuario)', async () => {
      const t = await ticketConFactura(alice.id);
      await request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .field('body', 'Mi justificante')
        .attach('files', TINY_PDF, { filename: 'mio.pdf', contentType: 'application/pdf' })
        .expect(201);
      const [adj] = await attachmentsOf(t.id);

      await request(server)
        .get(`/api/tickets/${t.id}/attachments/${adj.id}`)
        .set(auth(alice.token))
        .expect(200);
    });
  });

  // ===========================================================================
  // El nombre del cliente es entrada hostil
  // ===========================================================================

  describe('el nombre original es un dato del cliente, no una ruta ni una cabecera', () => {
    it('un nombre con CRLF y comillas no inyecta cabeceras en la descarga', async () => {
      const t = await userTicket(alice.id);
      const venenoso = 'ev"il\r\nX-Inyectada: si.png';

      await request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .field('body', 'Nombre raro')
        .attach('files', TINY_PNG, { filename: venenoso, contentType: 'image/png' })
        .expect(201);

      const [adj] = await attachmentsOf(t.id);
      // Saneado al ENTRAR: ni control chars ni comillas llegan a la columna.
      expect(adj.filename).not.toMatch(/[\r\n"]/);

      const res = await request(server)
        .get(`/api/tickets/${t.id}/attachments/${adj.id}`)
        .set(auth(alice.token))
        .expect(200);

      expect(res.headers['x-inyectada']).toBeUndefined();
      expect(res.headers['content-disposition']).not.toMatch(/[\r\n]/);
    });

    /**
     * Se ejerce contra el SERVICIO, no por HTTP, y a propósito: la librería
     * cliente de multipart recorta el nombre a su basename antes de enviarlo, así
     * que un `.attach({ filename: '../../x.png' })` llegaría ya inofensivo y el
     * test pasaría por mérito ajeno — sin probar nuestra defensa. Fabricando el
     * `Multer.File` a mano, el `originalname` hostil llega intacto a `prepare()`.
     */
    it('un nombre con separadores de ruta no puede escapar del prefijo del ticket', async () => {
      const t = await userTicket(alice.id);
      const attachments = app.get(TicketAttachmentsService);

      const [preparado] = await attachments.prepare(t.id, [
        {
          originalname: '../../../etc/passwd.png',
          mimetype: 'image/png',
          size: TINY_PNG.length,
          buffer: TINY_PNG,
        } as Express.Multer.File,
      ]);

      expect(preparado.key.startsWith(`tickets/${t.id}/`)).toBe(true);
      expect(preparado.key).not.toContain('..');
      expect(preparado.key).not.toContain('passwd');
      // El nombre visible se queda, pero sin barras: es una etiqueta, no una ruta.
      expect(preparado.filename).not.toContain('/');
      expect(preparado.filename).toBe('.._.._.._etc_passwd.png');

      await attachments.discard([preparado.key]);
    });
  });

  // ===========================================================================
  // El fichero de verdad está en R2 y vuelve igual
  // ===========================================================================

  describe('ida y vuelta contra R2', () => {
    it('el objeto existe en el bucket bajo la clave guardada', async () => {
      const t = await userTicket(alice.id);
      await request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .field('body', 'Round trip')
        .attach('files', TINY_PDF, { filename: 'rt.pdf', contentType: 'application/pdf' })
        .expect(201);

      const [adj] = await attachmentsOf(t.id);
      const desdeR2 = await r2.download(adj.key);
      expect(Buffer.compare(desdeR2, TINY_PDF)).toBe(0);
    });

    it('si la escritura en BD falla, el objeto subido NO se queda huérfano en R2', async () => {
      const t = await userTicket(alice.id);
      // Se rompe la transacción del mensaje DESPUÉS de que el fichero ya esté en R2.
      const borrar = jest.spyOn(r2, 'delete');
      const escribir = jest
        .spyOn(tickets as unknown as { writeMessage: () => Promise<never> }, 'writeMessage')
        .mockRejectedValue(new Error('boom'));

      try {
        await request(server)
          .post(`/api/tickets/${t.id}/messages`)
          .set(auth(alice.token))
          .field('body', 'Fallará')
          .attach('files', TINY_PNG, { filename: 'huerfano.png', contentType: 'image/png' })
          .expect(500);

        expect(borrar).toHaveBeenCalledTimes(1);
        expect((borrar.mock.calls[0][0] as string).startsWith(`tickets/${t.id}/`)).toBe(true);
        expect(await attachmentsOf(t.id)).toHaveLength(0);
      } finally {
        escribir.mockRestore();
        borrar.mockRestore();
      }
    });
  });
});
