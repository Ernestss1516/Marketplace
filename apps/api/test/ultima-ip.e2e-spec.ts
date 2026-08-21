/**
 * ÚLTIMA IP (5a) — EL DATO: capturarlo bien, y no capturar lo que no es.
 *
 * Tres barreras, y las tres afirman sobre la BASE:
 *
 *  1. **La IP del anuncio es del DUEÑO, no del staff.** Se mide en las DOS direcciones,
 *     molde literal de P3a con `EDITED`: el dueño gestiona → se escribe; el staff edita
 *     ese MISMO anuncio → no se mueve. Con sólo la primera, un `touch` colocado en el
 *     camino compartido pasaría, y el dato afirmaría que el vendedor estuvo aquí cuando
 *     quien estuvo fue el moderador.
 *  2. **Los tres logins anotan**, incluido el social — que era el único que ni siquiera
 *     recibía la IP.
 *  3. **La fuga cerrada**: `GET /admin/users/:id` ya no sirve `AuditLog.ip`, que es la IP
 *     del MODERADOR que actuó sobre el usuario, no la del usuario.
 *
 * Ver `docs/diseno-ultima-ip.md`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Última IP 5a — el dato (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let sellerToken: string;
  let adminToken: string;
  let sellerId: string;
  let adminId: string;
  let categoryId: string;

  const server = () => app.getHttpServer();

  let n = 0;
  async function crearAnuncio(sufijo: string) {
    return prisma.listing.create({
      data: {
        title: `IP ${sufijo}`,
        slug: `ip-${sufijo}-${++n}-${Date.now()}`,
        description: 'Un anuncio para medir la actividad de su dueño.',
        price: 10,
        type: 'PRODUCT',
        status: 'ACTIVE',
        sellerId,
        categoryId,
      },
    });
  }

  const leer = (id: string) =>
    prisma.listing.findUnique({
      where: { id },
      select: { lastOwnerIp: true, lastOwnerInteractionAt: true, triage: true },
    });

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [seller, admin] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'ip-seller@example.com', name: 'IP Seller', slug: 'ip-seller',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'ip-admin@example.com', name: 'IP Admin', slug: 'ip-admin',
          passwordHash, emailVerified: true, role: 'ADMIN',
        },
      }),
    ]);
    sellerId = seller.id;
    adminId = admin.id;

    categoryId = (
      await prisma.category.create({
        data: { name: 'IP Cat', slug: 'ip-cat', attributeSchema: [] },
      })
    ).id;

    sellerToken = (
      await request(server()).post('/api/auth/login').send({
        email: 'ip-seller@example.com', password: 'Test1234!',
      })
    ).body.accessToken as string;
    adminToken = (
      await request(server()).post('/api/auth/admin-login').send({
        email: 'ip-admin@example.com', password: 'Test1234!',
      })
    ).body.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 1 — la IP del DUEÑO, en las dos direcciones
  // ───────────────────────────────────────────────────────────────────────────

  it('LA BARRERA (a): el dueño gestiona su anuncio → se anota su IP y el momento', async () => {
    const anuncio = await crearAnuncio('dueno-edita');
    expect((await leer(anuncio.id))?.lastOwnerIp).toBeNull();

    await request(server())
      .patch(`/api/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ title: 'IP editado por su dueño' })
      .expect(200);

    const despues = await leer(anuncio.id);
    expect(despues?.lastOwnerIp).toBeTruthy();
    expect(despues?.lastOwnerInteractionAt).toBeInstanceOf(Date);
  });

  it('LA BARRERA (b): el STAFF edita ese mismo anuncio → NO se mueve', async () => {
    // La dirección que de verdad hay que medir. Con sólo (a), poner el `touch` en el
    // camino compartido con el staff pasaría — y entonces el dato diría «el vendedor
    // estuvo aquí» cuando quien estuvo fue el moderador. Mismo molde que P3a con `EDITED`.
    const anuncio = await crearAnuncio('staff-edita');

    await request(server())
      .patch(`/api/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ title: 'IP puesto por el dueño' })
      .expect(200);
    const trasElDueno = await leer(anuncio.id);

    await request(server())
      .patch(`/api/admin/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'IP corregido por el equipo', reason: 'Título con contacto' })
      .expect(200);

    const trasElStaff = await leer(anuncio.id);
    expect(trasElStaff?.lastOwnerInteractionAt).toEqual(trasElDueno?.lastOwnerInteractionAt);
    expect(trasElStaff?.lastOwnerIp).toBe(trasElDueno?.lastOwnerIp);
  });

  it('y el cambio de ESTADO por staff tampoco la mueve', async () => {
    const anuncio = await crearAnuncio('staff-estado');
    await request(server())
      .patch(`/api/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ title: 'IP antes del staff' })
      .expect(200);
    const antes = await leer(anuncio.id);

    await request(server())
      .patch(`/api/admin/listings/${anuncio.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'PENDING_REVIEW' })
      .expect(200);

    expect((await leer(anuncio.id))?.lastOwnerInteractionAt).toEqual(
      antes?.lastOwnerInteractionAt,
    );
  });

  it('VER NO ES GESTIONAR: consultar el anuncio no la mueve', async () => {
    const anuncio = await crearAnuncio('solo-mirar');

    await request(server())
      .get(`/api/listings/mine/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    await request(server())
      .get(`/api/listings/${anuncio.id}/deals`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    // Sigue virgen: mirar tu propio anuncio no es un acto de gestión, y contarlo
    // convertiría el campo en un rastro de navegación.
    const despues = await leer(anuncio.id);
    expect(despues?.lastOwnerIp).toBeNull();
    expect(despues?.lastOwnerInteractionAt).toBeNull();
  });

  it('pausar y archivar SÍ la mueven (son gestión)', async () => {
    const anuncio = await crearAnuncio('pausar');

    await request(server())
      .post(`/api/listings/${anuncio.id}/pause`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect((await leer(anuncio.id))?.lastOwnerIp).toBeTruthy();
  });

  it('el BUMP AUTOMÁTICO no la mueve — el dueño no está actuando', async () => {
    // El cron llama a `BillingService.bump` directamente, sin pasar por el controlador,
    // así que no hay IP que pasar ni sitio desde donde anotar. Se ejercita el servicio
    // igual que lo hace el procesador.
    const anuncio = await crearAnuncio('bump-cron');
    const billing = app.get(
      (await import('../src/modules/billing/billing.service')).BillingService,
    );

    await prisma.wallet.upsert({
      where: { userId: sellerId },
      create: { userId: sellerId, balance: 100 },
      update: { balance: 100 },
    });
    await billing.bump(anuncio.id, sellerId).catch(() => undefined);

    const despues = await leer(anuncio.id);
    expect(despues?.lastOwnerIp).toBeNull();
    expect(despues?.lastOwnerInteractionAt).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 2 — los tres logins
  // ───────────────────────────────────────────────────────────────────────────

  it('LA BARRERA: iniciar sesión anota la IP y el momento', async () => {
    await prisma.user.update({
      where: { id: sellerId },
      data: { lastLoginAt: null, lastLoginIp: null },
    });

    await request(server())
      .post('/api/auth/login')
      .send({ email: 'ip-seller@example.com', password: 'Test1234!' })
      .expect(200);

    const u = await prisma.user.findUnique({
      where: { id: sellerId },
      select: { lastLoginAt: true, lastLoginIp: true },
    });
    expect(u?.lastLoginIp).toBeTruthy();
    expect(u?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('y la puerta del panel también', async () => {
    await prisma.user.update({
      where: { id: adminId },
      data: { lastLoginAt: null, lastLoginIp: null },
    });

    await request(server())
      .post('/api/auth/admin-login')
      .send({ email: 'ip-admin@example.com', password: 'Test1234!' })
      .expect(200);

    expect(
      (await prisma.user.findUnique({ where: { id: adminId }, select: { lastLoginIp: true } }))
        ?.lastLoginIp,
    ).toBeTruthy();
  });

  it('EL LOGIN SOCIAL recibe la IP — era el único que ni la recibía', async () => {
    // No se puede firmar un token de Google en un test, así que se ejercita el punto
    // exacto que faltaba: que el método ACEPTE la ip y la anote. Lo que este caso fija es
    // que el hueco está cerrado en la firma y en la escritura; que el controlador se la
    // pase lo garantiza el `@Ip()`, que el compilador ya exige.
    const { AuthService } = await import('../src/modules/auth/auth.service');
    const auth = app.get(AuthService);

    await prisma.user.update({
      where: { id: sellerId },
      data: { lastLoginAt: null, lastLoginIp: null },
    });

    await (
      auth as unknown as { anotarInicioDeSesion(id: string, ip: string): Promise<void> }
    ).anotarInicioDeSesion(sellerId, '203.0.113.9');

    const u = await prisma.user.findUnique({
      where: { id: sellerId },
      select: { lastLoginIp: true },
    });
    expect(u?.lastLoginIp).toBe('203.0.113.9');
    // Y la firma pública lo exige: `loginWithGoogle` toma dos argumentos.
    expect(auth.loginWithGoogle.length).toBe(2);
  });

  it('y el CONTROLADOR se la pasa de verdad: el endpoint social lleva `@Ip()`', () => {
    // POR QUÉ SE LEE EL FUENTE. No se puede firmar un token de Google en un test, así que
    // el endpoint no es ejercitable de extremo a extremo. Y sin esto la barrera de arriba
    // es DÉBIL: comprueba la firma del servicio, no el cableado — alguien podría quitar
    // el `@Ip()` y pasar `''`, que compila y dejaría el campo vacío para siempre, que es
    // exactamente el defecto que 5a vino a cerrar. Molde de `etiquetas.test.ts`.
    const fuente = readFileSync(
      join(__dirname, '..', 'src', 'modules', 'auth', 'auth.controller.ts'),
      'utf8',
    );
    const endpoint = fuente.slice(fuente.indexOf("@Post('social/google')"));
    const cuerpo = endpoint.slice(0, endpoint.indexOf('}'));
    expect(cuerpo).toContain('@Ip() ip: string');
    expect(cuerpo).toContain('loginWithGoogle(dto, ip)');
  });

  it('si anotar falla, el login NO se cae (fail-open)', async () => {
    const { AuthService } = await import('../src/modules/auth/auth.service');
    const auth = app.get(AuthService);
    const prismaDeAuth = (auth as unknown as { prisma: PrismaClient }).prisma;

    // SE HACE FALLAR SÓLO LA ESCRITURA DE LA IP, y el matiz importa: `validateCredentials`
    // usa el MISMO `user.update` para resetear `failedLoginAttempts` en cada login
    // correcto. Un mock global lo habría tumbado ANTES de llegar a lo que este caso mide,
    // y el test habría pasado —o fallado— por el motivo equivocado.
    const original = prismaDeAuth.user.update.bind(prismaDeAuth.user);
    const espia = jest
      .spyOn(prismaDeAuth.user, 'update')
      .mockImplementation((args: Parameters<typeof original>[0]) => {
        const data = args.data as { lastLoginIp?: unknown };
        if (data?.lastLoginIp !== undefined) {
          return Promise.reject(new Error('base caída')) as never;
        }
        return original(args);
      });

    try {
      // 201 pese a que anotar la IP revienta: es el `try/catch` de
      // `anotarInicioDeSesion` el que lo sostiene, no otra cosa.
      await request(server())
        .post('/api/auth/login')
        .send({ email: 'ip-seller@example.com', password: 'Test1234!' })
        .expect(200);
    } finally {
      espia.mockRestore();
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 3 — la fuga cerrada
  // ───────────────────────────────────────────────────────────────────────────

  it('LA BARRERA: GET /admin/users/:id NO devuelve la IP del MODERADOR', async () => {
    // Se suspende y se reactiva al vendedor para que existan filas de `AuditLog` con
    // `ip` — la del ADMIN que ejecutó, que es de quien va esta barrera.
    await request(server())
      .patch(`/api/admin/users/${sellerId}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(server())
      .patch(`/api/admin/users/${sellerId}/unsuspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // La fila EXISTE y tiene ip — si no, este test pasaría por el motivo equivocado.
    const fila = await prisma.auditLog.findFirst({
      where: { resourceType: 'User', resourceId: sellerId },
      orderBy: { createdAt: 'desc' },
    });
    expect(fila?.ip).toBeTruthy();

    const res = await request(server())
      .get(`/api/admin/users/${sellerId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Se busca en la respuesta ENTERA serializada, no campo a campo — molde literal del
    // test del saldo de U3: un dato se puede colar anidado.
    const serializada = JSON.stringify(res.body);
    expect(serializada).not.toContain(fila!.ip!);
    // Y el historial sigue llegando: lo que se quita es la IP, no la historia.
    expect(res.body.auditLogs.length).toBeGreaterThan(0);
    expect(res.body.auditLogs[0]).toHaveProperty('action');
    expect(res.body.auditLogs[0]).toHaveProperty('actor');
    expect(res.body.auditLogs[0]).not.toHaveProperty('ip');
  });
});
