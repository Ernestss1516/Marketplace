/**
 * FIX — `updateSetting` es UPSERT, no `findUnique` + 404.
 *
 * El bug: varias claves del whitelist nacen A PROPÓSITO sin fila en la base ("sin
 * configurar" → la lectura cae a su DEFAULT_*). Con `findUnique` + NotFound, el PATCH
 * devolvía 404 y quedaban ineditables PARA SIEMPRE — un catch-22: para editarlas la fila
 * debía existir, y para que existiera había que editarlas. Tres claves afectadas:
 * `maxTagsPerListing` (B1), `supportEmail` y `ticketAutoCloseWindowDays` (tickets).
 *
 * Lo que se ejerce aquí es el camino de CREACIÓN — el que antes daba 404 — y, sobre todo,
 * que el upsert NO haya abierto ninguna puerta: el whitelist sigue siendo la única
 * defensa y las validaciones por-clave siguen corriendo ANTES de tocar la base.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

/** Las tres claves del whitelist que nacen sin fila. Se limpian antes y después. */
const CLAVES_SIN_SEMBRAR = ['maxTagsPerListing', 'supportEmail', 'ticketAutoCloseWindowDays'];

describe('Settings — el PATCH crea la fila si no existe (upsert, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let adminId: string;

  const admin = () => ({ Authorization: `Bearer ${adminToken}` });

  /** El estado base no tiene estas filas: cada test parte de "sin sembrar" de verdad. */
  const limpiar = () =>
    prisma.setting.deleteMany({ where: { key: { in: CLAVES_SIN_SEMBRAR } } });

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();

    const user = await prisma.user.upsert({
      where: { email: 'set-upsert-admin@example.com' },
      create: {
        email: 'set-upsert-admin@example.com', name: 'Settings Admin', slug: 'set-upsert-admin',
        passwordHash: await bcrypt.hash('Test1234!', 4), emailVerified: true, role: 'ADMIN',
      },
      update: { role: 'ADMIN' },
    });
    adminId = user.id;

    adminToken = (await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: 'set-upsert-admin@example.com', password: 'Test1234!' })).body.accessToken;
  }, 60_000);

  beforeEach(limpiar);

  afterAll(async () => {
    // El upsert no siembra nada: el estado base queda como estaba, para que dos
    // corridas consecutivas sean idénticas.
    await limpiar();
    await prisma.auditLog.deleteMany({
      where: { action: 'SETTING_UPDATE', resourceId: { in: CLAVES_SIN_SEMBRAR } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  // ── El camino que antes daba 404 ─────────────────────────────────────────────

  it('clave válida SIN fila previa → 200 y la fila se CREA', async () => {
    expect(await prisma.setting.findUnique({ where: { key: 'maxTagsPerListing' } })).toBeNull();

    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 8 }).expect(200);

    expect(res.body.value).toBe(8);

    const fila = await prisma.setting.findUnique({ where: { key: 'maxTagsPerListing' } });
    expect(fila).not.toBeNull();
    expect(fila?.value).toBe(8);
  });

  it('el valor puesto es el que se lee después — ya no el default', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 12 }).expect(200);

    // Vía la API pública de admin, no leyendo la tabla: es lo que ve el editor.
    const listado = await request(app.getHttpServer())
      .get('/api/admin/settings').set(admin()).expect(200);
    const encontrado = listado.body.find((s: { key: string }) => s.key === 'maxTagsPerListing');
    expect(encontrado?.value).toBe(12);
  });

  it('el segundo PATCH actualiza la fila, no crea otra', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 8 }).expect(200);
    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 3 }).expect(200);

    expect(res.body.value).toBe(3);
    // `key` es @id, así que una segunda fila es imposible; se comprueba igual porque
    // lo que se afirma es que el upsert eligió el camino de update.
    expect(await prisma.setting.count({ where: { key: 'maxTagsPerListing' } })).toBe(1);
  });

  it('un setting que YA tenía fila se comporta idéntico a antes', async () => {
    // `badWordList` sí está sembrado: el camino de update no ha cambiado.
    const antes = await prisma.setting.findUnique({ where: { key: 'badWordList' } });
    expect(antes).not.toBeNull();

    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/badWordList').set(admin())
      .send({ value: ['upsert-test'] }).expect(200);
    expect(res.body.value).toEqual(['upsert-test']);

    await prisma.setting.update({
      where: { key: 'badWordList' },
      data: { value: antes!.value as never },
    });
  });

  // ── Las tres claves que estaban ineditables ──────────────────────────────────

  it('supportEmail — ineditable antes del fix, ahora se crea con el PATCH', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/supportEmail').set(admin())
      .send({ value: 'soporte@example.com' }).expect(200);

    expect(res.body.value).toBe('soporte@example.com');
    expect((await prisma.setting.findUnique({ where: { key: 'supportEmail' } }))?.value)
      .toBe('soporte@example.com');
  });

  it('ticketAutoCloseWindowDays — ineditable antes del fix, ahora se crea con el PATCH', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/ticketAutoCloseWindowDays').set(admin())
      .send({ value: 21 }).expect(200);

    expect(res.body.value).toBe(21);
    expect((await prisma.setting.findUnique({ where: { key: 'ticketAutoCloseWindowDays' } }))?.value)
      .toBe(21);
  });

  // ── El whitelist sigue siendo la puerta ──────────────────────────────────────

  it('clave FUERA del whitelist → 400 y NO se crea fila basura', async () => {
    const antes = await prisma.setting.count();

    await request(app.getHttpServer())
      .patch('/api/admin/settings/clave-inventada-por-el-atacante').set(admin())
      .send({ value: 'lo-que-sea' }).expect(400);

    expect(await prisma.setting.findUnique({ where: { key: 'clave-inventada-por-el-atacante' } }))
      .toBeNull();
    // Y ninguna otra fila: el upsert no llegó a ejecutarse en absoluto.
    expect(await prisma.setting.count()).toBe(antes);
  });

  it('el ataque tampoco cuela con una clave que PARECE de settings', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/settings/isAdmin').set(admin())
      .send({ value: true }).expect(400);

    expect(await prisma.setting.findUnique({ where: { key: 'isAdmin' } })).toBeNull();
  });

  // ── Las validaciones por-clave corren ANTES del upsert ───────────────────────

  it('POSITIVE_INT: valor 0 en clave SIN fila → 400 y no se crea la fila', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 0 });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/mayor o igual a 1/);
    expect(await prisma.setting.findUnique({ where: { key: 'maxTagsPerListing' } })).toBeNull();
  });

  it('POSITIVE_INT: valor 0 en clave CON fila → 400 y la fila no cambia', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 7 }).expect(200);

    await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 0 }).expect(400);

    expect((await prisma.setting.findUnique({ where: { key: 'maxTagsPerListing' } }))?.value).toBe(7);
  });

  it('POSITIVE_INT: negativo y decimal también se rechazan en el camino de creación', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: -3 }).expect(400);
    await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 2.5 }).expect(400);

    expect(await prisma.setting.findUnique({ where: { key: 'maxTagsPerListing' } })).toBeNull();
  });

  it('PERCENT: la validación [0,100] sigue en pie', async () => {
    // `proExtraCreditsPercent` sí está sembrado, así que esto cubre que cambiar a
    // upsert no se ha llevado por delante la rama de porcentajes.
    await request(app.getHttpServer())
      .patch('/api/admin/settings/proExtraCreditsPercent').set(admin())
      .send({ value: 101 }).expect(400);
    await request(app.getHttpServer())
      .patch('/api/admin/settings/proExtraCreditsPercent').set(admin())
      .send({ value: -1 }).expect(400);
  });

  // ── Trazabilidad: updatedById y AuditLog en el camino de CREACIÓN ────────────

  it('la fila creada guarda updatedById del admin que la creó', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 6 }).expect(200);

    const fila = await prisma.setting.findUnique({ where: { key: 'maxTagsPerListing' } });
    expect(fila?.updatedById).toBe(adminId);
  });

  it('crear la fila registra SETTING_UPDATE con el actorId correcto', async () => {
    await prisma.auditLog.deleteMany({
      where: { action: 'SETTING_UPDATE', resourceId: 'maxTagsPerListing' },
    });

    await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 9 }).expect(200);

    const entradas = await prisma.auditLog.findMany({
      where: { action: 'SETTING_UPDATE', resourceId: 'maxTagsPerListing' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entradas).toHaveLength(1);
    expect(entradas[0].actorId).toBe(adminId);
    expect(entradas[0].resourceType).toBe('Setting');
    // `before` con value null es la marca de "no había fila"; `after`, lo que se puso.
    expect((entradas[0].before as { value: unknown } | null)?.value ?? null).toBeNull();
    expect((entradas[0].after as { value: unknown }).value).toBe(9);
  });

  it('actualizar una fila existente sigue registrando el before real', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 4 }).expect(200);

    await prisma.auditLog.deleteMany({
      where: { action: 'SETTING_UPDATE', resourceId: 'maxTagsPerListing' },
    });

    await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 10 }).expect(200);

    const entrada = await prisma.auditLog.findFirst({
      where: { action: 'SETTING_UPDATE', resourceId: 'maxTagsPerListing' },
      orderBy: { createdAt: 'desc' },
    });
    expect((entrada!.before as { value: unknown }).value).toBe(4);
    expect((entrada!.after as { value: unknown }).value).toBe(10);
  });

  it('un 400 NO deja rastro en el audit log', async () => {
    await prisma.auditLog.deleteMany({
      where: { action: 'SETTING_UPDATE', resourceId: 'maxTagsPerListing' },
    });

    await request(app.getHttpServer())
      .patch('/api/admin/settings/maxTagsPerListing').set(admin())
      .send({ value: 0 }).expect(400);

    expect(await prisma.auditLog.count({
      where: { action: 'SETTING_UPDATE', resourceId: 'maxTagsPerListing' },
    })).toBe(0);
  });
});
