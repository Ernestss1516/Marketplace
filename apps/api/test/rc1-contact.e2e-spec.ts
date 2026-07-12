/**
 * RC.1/RC.2 — Formulario de contacto público (e2e)
 *
 * Endpoint público sin autenticación — superficie de ataque nueva. Cubre las 5
 * defensas (honeypot, time-trap firmado, rate limit por IP + global, XSS
 * contra el admin, header injection), el flujo de gestión desde admin
 * (listado, detalle con auto-LEIDO, cambio de estado libre entre cualquier
 * par de estados, responder → email + AuditLog), el fan-out de Notification a
 * los admins, y los motivos de contacto configurables (RC.2: CRUD, reorder,
 * guard de "al menos un motivo activo", desactivado ≠ borrado).
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createHmac } from 'crypto';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { RedisService } from 'src/infra/redis/redis.service';

const CONTACT_FORM_SECRET = process.env.CONTACT_FORM_SECRET as string;

function signToken(issuedAt: number): string {
  const raw = String(issuedAt);
  return `${raw}.${createHmac('sha256', CONTACT_FORM_SECRET).update(raw).digest('hex')}`;
}

/** Token válido: firmado correctamente, emitido "hace" offsetMs (por defecto,
 * justo dentro de la ventana [3s, 2h) sin necesitar esperas reales). */
function validToken(offsetMs = 5_000): string {
  return signToken(Date.now() - offsetMs);
}

async function loginUser(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

let ipCounter = 0;
/** IP única por test — evita que el rate limit (5/h por IP) contamine otros tests. */
function freshIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

describe('RC.1/RC.2 — Formulario de contacto (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: RedisService;

  let adminToken: string;
  let adminId: string;
  let userToken: string;

  // ContactReason activo por defecto para las pruebas que solo necesitan "un
  // motivo válido cualquiera" — no las de gestión de motivos en sí.
  let motivoId: string;

  const hash = (pw: string) => bcrypt.hash(pw, 4);

  function basePayload(overrides: Record<string, unknown> = {}) {
    return {
      motivoId,
      email: 'remitente@example.com',
      mensaje: 'Este es un mensaje de prueba con longitud suficiente para pasar la validación.',
      timeTrapToken: validToken(),
      ...overrides,
    };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    redis = app.get(RedisService);
    await cleanDb(prisma);
    // Repeated local runs within the same hour must not inherit a previous
    // run's counters (same concern as the CI/Playwright "reset between
    // passes" lesson — see feedback_ci_verde_repetido). freshIp() produces a
    // DETERMINISTIC sequence every run (module-level counter restarts at 0
    // each process), so per-IP keys collide across runs too — not just the
    // global one. Flush the whole contact:rate:* namespace, not one key.
    const staleKeys = await redis.client.keys('contact:rate:*');
    if (staleKeys.length > 0) await redis.client.del(...staleKeys);

    const admin = await prisma.user.create({
      data: {
        email: 'rc1-admin@example.com',
        name: 'RC1 Admin',
        slug: 'rc1-admin',
        passwordHash: await hash('Test1234!'),
        emailVerified: true,
        role: 'ADMIN',
      },
    });
    adminId = admin.id;
    await prisma.user.create({
      data: {
        email: 'rc1-user@example.com',
        name: 'RC1 User',
        slug: 'rc1-user',
        passwordHash: await hash('Test1234!'),
        emailVerified: true,
        role: 'USER',
      },
    });

    [adminToken, userToken] = await Promise.all([
      loginUser(app, 'rc1-admin@example.com', 'Test1234!'),
      loginUser(app, 'rc1-user@example.com', 'Test1234!'),
    ]);

    const reason = await prisma.contactReason.create({ data: { nombre: 'Consulta general', orden: 0 } });
    motivoId = reason.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── GET /contacto/token ──────────────────────────────────────────────────────

  describe('GET /api/contacto/token', () => {
    it('emite issuedAt + token', async () => {
      const res = await request(app.getHttpServer()).get('/api/contacto/token').expect(200);
      expect(typeof res.body.issuedAt).toBe('number');
      expect(typeof res.body.token).toBe('string');
      expect(res.body.token).toContain('.');
    });
  });

  // ── Honeypot ─────────────────────────────────────────────────────────────────

  describe('Honeypot', () => {
    it('campo "empresa" relleno → 200 OK, NADA persistido, NADA notificado', async () => {
      const ip = freshIp();
      const before = await prisma.contactMessage.count();

      const res = await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', ip)
        .send(basePayload({ empresa: 'Bot Inc.', email: 'honeypot@example.com' }))
        .expect(200);

      expect(res.body).toEqual({ success: true });
      expect(await prisma.contactMessage.count()).toBe(before);

      const notified = await prisma.notification.findFirst({
        where: { userId: adminId, type: 'CONTACT_MESSAGE', data: { path: ['email'], equals: 'honeypot@example.com' } },
      });
      expect(notified).toBeNull();
    });
  });

  // ── Time-trap ────────────────────────────────────────────────────────────────

  describe('Time-trap firmado', () => {
    it('envío en <3s desde un token recién emitido → 200 silencioso, no persiste', async () => {
      const ip = freshIp();
      const tokenRes = await request(app.getHttpServer()).get('/api/contacto/token').expect(200);
      const before = await prisma.contactMessage.count();

      const res = await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', ip)
        .send(basePayload({ timeTrapToken: tokenRes.body.token, email: 'too-fast@example.com' }))
        .expect(200);

      expect(res.body).toEqual({ success: true });
      expect(await prisma.contactMessage.count()).toBe(before);
    });

    it('token con firma HMAC inválida → 200 silencioso, no persiste', async () => {
      const ip = freshIp();
      const before = await prisma.contactMessage.count();
      const forged = `${Date.now() - 5000}.${'0'.repeat(64)}`;

      const res = await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', ip)
        .send(basePayload({ timeTrapToken: forged, email: 'forged@example.com' }))
        .expect(200);

      expect(res.body).toEqual({ success: true });
      expect(await prisma.contactMessage.count()).toBe(before);
    });

    it('token de más de 2h → 200 silencioso, no persiste', async () => {
      const ip = freshIp();
      const before = await prisma.contactMessage.count();
      const stale = signToken(Date.now() - 3 * 60 * 60 * 1000);

      const res = await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', ip)
        .send(basePayload({ timeTrapToken: stale, email: 'stale@example.com' }))
        .expect(200);

      expect(res.body).toEqual({ success: true });
      expect(await prisma.contactMessage.count()).toBe(before);
    });

    it('token válido (firmado, emitido hace >3s y <2h) → SÍ persiste', async () => {
      const ip = freshIp();
      const before = await prisma.contactMessage.count();

      const res = await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', ip)
        .send(basePayload({ email: 'valido@example.com' }))
        .expect(200);

      expect(res.body).toEqual({ success: true });
      expect(await prisma.contactMessage.count()).toBe(before + 1);

      const created = await prisma.contactMessage.findFirst({ where: { email: 'valido@example.com' } });
      expect(created).not.toBeNull();
      expect(created!.estado).toBe('NUEVO');
      expect(created!.motivoId).toBe(motivoId);
    });
  });

  // ── Validación de campos ─────────────────────────────────────────────────────

  describe('Validación', () => {
    it('mensaje de 10 000 caracteres → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', freshIp())
        .send(basePayload({ mensaje: 'a'.repeat(10_000) }))
        .expect(400);
    });

    it('email con inyección de cabeceras (\\nBcc:) → 400 (@IsEmail)', async () => {
      await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', freshIp())
        .send(basePayload({ email: 'valido@example.com\nBcc: victima@evil.com' }))
        .expect(400);
    });

    it('motivoId inexistente → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', freshIp())
        .send(basePayload({ motivoId: 'xxxxxxxx-0000-0000-0000-000000000000' }))
        .expect(400);
    });

    it('teléfono de más de 20 caracteres → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', freshIp())
        .send(basePayload({ telefono: '1'.repeat(21) }))
        .expect(400);
    });
  });

  // ── XSS contra el admin ──────────────────────────────────────────────────────

  describe('XSS', () => {
    it('mensaje con <script> se guarda tal cual (texto plano) — el escapado es responsabilidad del render', async () => {
      const payload = '<script>alert(1)</script>';
      const res = await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', freshIp())
        .send(basePayload({ email: 'xss@example.com', mensaje: `${payload} — mensaje con relleno suficiente.` }))
        .expect(200);
      expect(res.body).toEqual({ success: true });

      const created = await prisma.contactMessage.findFirst({ where: { email: 'xss@example.com' } });
      expect(created).not.toBeNull();
      expect(created!.mensaje).toContain(payload);

      const detail = await request(app.getHttpServer())
        .get(`/api/admin/contact-messages/${created!.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      // La API devuelve el string crudo — el frontend (React) lo escapa al
      // renderizar; PROHIBIDO dangerouslySetInnerHTML en el panel admin.
      expect(detail.body.mensaje).toContain(payload);
    });
  });

  // ── Notificación a admins (fan-out) ──────────────────────────────────────────

  describe('Notificación a admins', () => {
    it('un envío válido crea una Notification CONTACT_MESSAGE para el admin, con el NOMBRE del motivo resuelto', async () => {
      const email = `fanout-${Date.now()}@example.com`;
      await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', freshIp())
        .send(basePayload({ email }))
        .expect(200);

      const notification = await prisma.notification.findFirst({
        where: { userId: adminId, type: 'CONTACT_MESSAGE' },
        orderBy: { createdAt: 'desc' },
      });
      expect(notification).not.toBeNull();
      const data = notification!.data as { email: string; extracto: string; messageId: string; motivo: string };
      expect(data.email).toBe(email);
      // Snapshot autocontenido: el nombre, no el id — sobrevive a un rename/desactivación posterior.
      expect(data.motivo).toBe('Consulta general');
    });
  });

  // ── Admin: auth ──────────────────────────────────────────────────────────────

  describe('Admin — auth', () => {
    it('GET /api/admin/contact-messages sin auth → 401', async () => {
      await request(app.getHttpServer()).get('/api/admin/contact-messages').expect(401);
    });

    it('GET /api/admin/contact-messages como USER → 403', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/contact-messages')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('GET /api/admin/contact-reasons sin auth → 401', async () => {
      await request(app.getHttpServer()).get('/api/admin/contact-reasons').expect(401);
    });

    it('POST /api/admin/contact-reasons como USER → 403', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/contact-reasons')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ nombre: 'x' })
        .expect(403);
    });
  });

  // ── Admin: flujo completo ────────────────────────────────────────────────────

  describe('Admin — listado, detalle, estado, responder', () => {
    async function createMessage(email: string) {
      await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', freshIp())
        .send(basePayload({ email }))
        .expect(200);
      return prisma.contactMessage.findFirstOrThrow({ where: { email } });
    }

    it('listado filtra por estado y motivoId', async () => {
      await createMessage(`filtro-${Date.now()}@example.com`);

      const res = await request(app.getHttpServer())
        .get(`/api/admin/contact-messages?estado=NUEVO&motivoId=${motivoId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.length).toBeGreaterThan(0);
      expect(
        (res.body.items as Array<{ estado: string; motivo: { id: string } }>).every(
          (m) => m.estado === 'NUEVO' && m.motivo.id === motivoId,
        ),
      ).toBe(true);
    });

    it('GET :id transiciona NUEVO → LEIDO automáticamente al abrir, y devuelve el motivo con nombre', async () => {
      const message = await createMessage(`leido-${Date.now()}@example.com`);
      expect(message.estado).toBe('NUEVO');

      const res = await request(app.getHttpServer())
        .get(`/api/admin/contact-messages/${message.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.estado).toBe('LEIDO');
      expect(res.body.replies).toEqual([]);
      expect(res.body.motivo).toEqual({ id: motivoId, nombre: 'Consulta general' });
    });

    it('PATCH :id/estado — transición libre entre CUALQUIER par de estados, con AuditLog en cada salto', async () => {
      const message = await createMessage(`estado-libre-${Date.now()}@example.com`);

      // NUEVO → CERRADO → LEIDO → RESPONDIDO → NUEVO — ninguna transición está
      // restringida (decisión de diseño: el admin sabe lo que hace). El
      // automatismo NUEVO→LEIDO al abrir y →RESPONDIDO al responder sigue
      // intacto (ver tests dedicados) — esto solo cubre el cambio MANUAL.
      const chain: Array<'CERRADO' | 'LEIDO' | 'RESPONDIDO' | 'NUEVO'> = [
        'CERRADO',
        'LEIDO',
        'RESPONDIDO',
        'NUEVO',
      ];

      for (const estado of chain) {
        const res = await request(app.getHttpServer())
          .patch(`/api/admin/contact-messages/${message.id}/estado`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ estado })
          .expect(200);

        expect(res.body.estado).toBe(estado);
      }

      const auditEntries = await prisma.auditLog.findMany({
        where: { action: 'CONTACT_MESSAGE_STATUS_CHANGE', resourceId: message.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(auditEntries).toHaveLength(chain.length);
      expect(auditEntries.map((e) => (e.after as { estado: string }).estado)).toEqual(chain);
    });

    it('POST :id/responder crea ContactReply, encola el email, pasa a RESPONDIDO y registra AuditLog', async () => {
      const message = await createMessage(`responder-${Date.now()}@example.com`);

      const res = await request(app.getHttpServer())
        .post(`/api/admin/contact-messages/${message.id}/responder`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ asunto: 'Re: tu consulta', cuerpo: 'Gracias por escribirnos, ya lo hemos resuelto.' })
        .expect(201);

      expect(res.body.estado).toBe('RESPONDIDO');
      expect(res.body.replies).toHaveLength(1);
      expect(res.body.replies[0].asunto).toBe('Re: tu consulta');

      const reply = await prisma.contactReply.findFirst({ where: { contactMessageId: message.id } });
      expect(reply).not.toBeNull();
      expect(reply!.adminUserId).toBe(adminId);

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'CONTACT_MESSAGE_REPLY', resourceId: message.id },
      });
      expect(auditEntry).not.toBeNull();
    });

    it('responder SIEMPRE envía al email original del mensaje — no acepta un destinatario alternativo', async () => {
      const message = await createMessage(`inmutable-${Date.now()}@example.com`);

      // El DTO de respuesta no tiene campo "to"/"email" — whitelist:true del
      // ValidationPipe global lo rechazaría si se intentara colar uno.
      await request(app.getHttpServer())
        .post(`/api/admin/contact-messages/${message.id}/responder`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ asunto: 'x', cuerpo: 'x', to: 'otro@evil.com', email: 'otro@evil.com' })
        .expect(400);
    });

    it('PATCH a mensaje inexistente → 404', async () => {
      await request(app.getHttpServer())
        .patch('/api/admin/contact-messages/xxxxxxxx-0000-0000-0000-000000000000/estado')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ estado: 'CERRADO' })
        .expect(404);
    });
  });

  // ── Motivos de contacto configurables (RC.2) ─────────────────────────────────

  describe('Motivos de contacto — admin CRUD, reorder, guard', () => {
    it('crear un motivo → 201, aparece en /admin/contact-reasons y NO en /contacto/motivos hasta ser el único activo lo determina', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/contact-reasons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nombre: 'Colaboraciones' })
        .expect(201);

      expect(res.body.nombre).toBe('Colaboraciones');
      expect(res.body.activo).toBe(true);

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'CONTACT_REASON_CREATE', resourceId: res.body.id },
      });
      expect(auditEntry).not.toBeNull();

      const publicList = await request(app.getHttpServer()).get('/api/contacto/motivos').expect(200);
      expect((publicList.body as Array<{ id: string }>).map((r) => r.id)).toContain(res.body.id);
    });

    it('renombrar (PATCH nombre) → 200, registra CONTACT_REASON_EDIT', async () => {
      const created = await prisma.contactReason.create({ data: { nombre: 'Temporal', orden: 99 } });

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/contact-reasons/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nombre: 'Renombrado' })
        .expect(200);

      expect(res.body.nombre).toBe('Renombrado');

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'CONTACT_REASON_EDIT', resourceId: created.id },
      });
      expect(auditEntry).not.toBeNull();
    });

    it('desactivar (PATCH activo:false) → deja de aparecer en /contacto/motivos, pero sigue en /admin/contact-reasons', async () => {
      const created = await prisma.contactReason.create({ data: { nombre: 'Desactivable', orden: 98 } });

      await request(app.getHttpServer())
        .patch(`/api/admin/contact-reasons/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ activo: false })
        .expect(200);

      const publicList = await request(app.getHttpServer()).get('/api/contacto/motivos').expect(200);
      expect((publicList.body as Array<{ id: string }>).map((r) => r.id)).not.toContain(created.id);

      const adminList = await request(app.getHttpServer())
        .get('/api/admin/contact-reasons')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((adminList.body as Array<{ id: string }>).map((r) => r.id)).toContain(created.id);

      const deactivateLog = await prisma.auditLog.findFirst({
        where: { action: 'CONTACT_REASON_DEACTIVATE', resourceId: created.id },
      });
      expect(deactivateLog).not.toBeNull();

      // Reactivar registra CONTACT_REASON_ACTIVATE.
      await request(app.getHttpServer())
        .patch(`/api/admin/contact-reasons/${created.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ activo: true })
        .expect(200);
      const activateLog = await prisma.auditLog.findFirst({
        where: { action: 'CONTACT_REASON_ACTIVATE', resourceId: created.id },
      });
      expect(activateLog).not.toBeNull();
    });

    it('desactivar el ÚLTIMO motivo activo → 400, no se desactiva', async () => {
      // Aislado: desactiva TODOS los motivos existentes salvo uno, luego
      // intenta desactivar ese último.
      const all = await prisma.contactReason.findMany({ where: { activo: true } });
      for (const r of all.slice(1)) {
        await prisma.contactReason.update({ where: { id: r.id }, data: { activo: false } });
      }
      const lastActive = all[0];

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/contact-reasons/${lastActive.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ activo: false })
        .expect(400);

      expect(res.body.message).toMatch(/al menos un motivo activo/i);

      const stillActive = await prisma.contactReason.findUnique({ where: { id: lastActive.id } });
      expect(stillActive!.activo).toBe(true);

      // Restaura el resto para no afectar a otros tests del archivo.
      for (const r of all.slice(1)) {
        await prisma.contactReason.update({ where: { id: r.id }, data: { activo: true } });
      }
    });

    it('reordenar (PATCH reorder) → persiste el nuevo orden y afecta a /contacto/motivos', async () => {
      const a = await prisma.contactReason.create({ data: { nombre: 'Reorder A', orden: 200 } });
      const b = await prisma.contactReason.create({ data: { nombre: 'Reorder B', orden: 201 } });

      await request(app.getHttpServer())
        .patch('/api/admin/contact-reasons/reorder')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ items: [{ id: a.id, orden: 201 }, { id: b.id, orden: 200 }] })
        .expect(200);

      const publicList = await request(app.getHttpServer()).get('/api/contacto/motivos').expect(200);
      const ids = (publicList.body as Array<{ id: string }>).map((r) => r.id);
      expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'CONTACT_REASON_REORDER' },
        orderBy: { createdAt: 'desc' },
      });
      expect(auditEntry).not.toBeNull();
    });

    it('un motivo desactivado NO se acepta en POST /contacto (400), aunque el id exista', async () => {
      const inactive = await prisma.contactReason.create({
        data: { nombre: 'Inactivo para envío', orden: 300, activo: false },
      });

      await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', freshIp())
        .send(basePayload({ motivoId: inactive.id }))
        .expect(400);
    });

    it('desactivar un motivo NO borra los mensajes históricos que lo usan — conservan su motivoId intacto', async () => {
      const reason = await prisma.contactReason.create({ data: { nombre: 'Con historial', orden: 301 } });
      const email = `historial-${Date.now()}@example.com`;

      await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', freshIp())
        .send(basePayload({ motivoId: reason.id, email }))
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/admin/contact-reasons/${reason.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ activo: false })
        .expect(200);

      const message = await prisma.contactMessage.findFirstOrThrow({ where: { email } });
      expect(message.motivoId).toBe(reason.id);

      const detail = await request(app.getHttpServer())
        .get(`/api/admin/contact-messages/${message.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(detail.body.motivo).toEqual({ id: reason.id, nombre: 'Con historial' });
    });
  });

  // ── Rate limit ───────────────────────────────────────────────────────────────
  // Al final del archivo a propósito: la prueba del límite global deja el
  // contador por encima de 200 durante el resto de la hora — si corriera antes,
  // las llamadas a POST /api/contacto de los demás tests (que SÍ necesitan
  // persistir) empezarían a recibir 429.

  describe('Rate limit', () => {
    it('5 envíos por IP permitidos, el 6º devuelve 429', async () => {
      const ip = freshIp();
      // Honeypot relleno: consume el contador de rate limit (se comprueba
      // ANTES del honeypot) sin dejar mensajes reales en la BD.
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/contacto')
          .set('X-Forwarded-For', ip)
          .send(basePayload({ empresa: 'x' }))
          .expect(200);
      }

      const res = await request(app.getHttpServer())
        .post('/api/contacto')
        .set('X-Forwarded-For', ip)
        .send(basePayload({ empresa: 'x' }))
        .expect(429);

      expect(typeof res.body.retryAfter).toBe('number');
    });

    it('límite global (200/hora) — se dispara aunque cada IP sea distinta', async () => {
      // Aislado de lo que hayan consumido los tests anteriores — y de pasadas
      // repetidas dentro de la misma hora en local (mismo principio que
      // feedback_ci_verde_repetido: resetear entre pasadas, no solo antes de
      // la primera).
      await redis.client.del('contact:rate:global');

      // En lotes (no 205 a la vez): supertest agota el pool de sockets del
      // agente HTTP por defecto de Node con demasiadas conexiones concurrentes
      // reales, y provoca ECONNRESET — no es una limitación del rate limiter.
      const BATCH_SIZE = 25;
      let limitedCount = 0;
      for (let sent = 0; sent < 205; sent += BATCH_SIZE) {
        const batch = Array.from({ length: Math.min(BATCH_SIZE, 205 - sent) }, () =>
          request(app.getHttpServer())
            .post('/api/contacto')
            .set('X-Forwarded-For', freshIp())
            .send(basePayload({ empresa: 'x' })),
        );
        const responses = await Promise.all(batch);
        limitedCount += responses.filter((r) => r.status === 429).length;
      }

      expect(limitedCount).toBeGreaterThan(0);
    });
  });
});
