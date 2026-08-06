// PORTADA CONFIGURABLE — RP.1 (config global de fila única + hero + esqueleto
// del motor de bloques). Molde: blocks.e2e-spec.ts.
//
// Cubre: la lectura pública; el gate de rol (solo ADMIN escribe); la validación
// del hero (tope de 6 opciones —que NO es estético, es el límite del rotativo
// CSS—, rango de velocidad, título obligatorio de verdad); la validación del
// array de bloques por discriminador (los 2 tipos de RP.1 pasan, un tipo aún no
// registrado y un href javascript: se rechazan); las reglas cruzadas del
// servicio (un solo buscador, ids únicos); y que NADA de lo rechazado llega a
// escribirse.

import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

// Config de partida y de restauración. Coincide con la que siembra
// prisma/seed-test.ts: esta suite MUTA una fila estática compartida (excluida
// de cleanDb, igual que Setting), así que la deja como la encontró.
const DEFAULTS = {
  heroStaticTitle: 'Compra y vende de segunda mano',
  heroRotatingOptions: [] as string[],
  heroRotationMs: 3000,
  heroSubtitle: null as string | null,
  blocks: [] as Prisma.InputJsonValue,
};

describe('Portada configurable — RP.1 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    await prisma.user.create({
      data: {
        email: 'portada-admin@example.com',
        name: 'Portada Admin',
        slug: 'portada-admin',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
        role: 'ADMIN',
      },
    });
    await prisma.user.create({
      data: {
        email: 'portada-user@example.com',
        name: 'Portada User',
        slug: 'portada-user',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
        role: 'USER',
      },
    });

    const adminRes = await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: 'portada-admin@example.com', password: 'Test1234!' });
    adminToken = adminRes.body.accessToken as string;

    const userRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'portada-user@example.com', password: 'Test1234!' });
    userToken = userRes.body.accessToken as string;

    await resetConfig();
  });

  afterAll(async () => {
    await resetConfig();
    await app.close();
    await prisma.$disconnect();
  });

  async function resetConfig() {
    await prisma.homepageConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...DEFAULTS },
      update: DEFAULTS,
    });
  }

  function patch(body: Record<string, unknown>, token = adminToken) {
    return request(app.getHttpServer())
      .patch('/api/admin/homepage')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  /** Cuerpo válido mínimo, con los campos que la prueba quiera sobrescribir. */
  function body(overrides: Record<string, unknown> = {}) {
    return { heroStaticTitle: 'Compra y vende', blocks: [], ...overrides };
  }

  // ── Lectura pública ────────────────────────────────────────────────────────

  it('GET /homepage es público y devuelve la config con el hero', async () => {
    const res = await request(app.getHttpServer()).get('/api/homepage').expect(200);
    expect(res.body.heroStaticTitle).toBe(DEFAULTS.heroStaticTitle);
    expect(res.body.heroRotatingOptions).toEqual([]);
    expect(res.body.heroRotationMs).toBe(3000);
    expect(res.body.blocks).toEqual([]);
    // updatedById no se expone: es dato de auditoría, no de portada.
    expect(res.body).not.toHaveProperty('updatedById');
  });

  // ── Gate de rol ────────────────────────────────────────────────────────────

  it('PATCH sin token → 401', async () => {
    await request(app.getHttpServer()).patch('/api/admin/homepage').send(body()).expect(401);
  });

  it('PATCH con rol USER → 403 (la portada es configuración, solo ADMIN)', async () => {
    await patch(body(), userToken).expect(403);
  });

  // ── Hero: el camino feliz ──────────────────────────────────────────────────

  it('PATCH válido con hero completo → 200 y persiste', async () => {
    const res = await patch(
      body({
        heroStaticTitle: 'Compra y vende',
        heroRotatingOptions: ['coches', 'bicicletas', 'muebles'],
        heroRotationMs: 2500,
        heroSubtitle: 'Miles de anuncios cerca de ti',
      }),
    ).expect(200);

    expect(res.body.heroStaticTitle).toBe('Compra y vende');
    expect(res.body.heroRotatingOptions).toEqual(['coches', 'bicicletas', 'muebles']);
    expect(res.body.heroRotationMs).toBe(2500);
    expect(res.body.heroSubtitle).toBe('Miles de anuncios cerca de ti');

    const row = await prisma.homepageConfig.findUnique({ where: { id: 'singleton' } });
    expect(row?.heroRotatingOptions).toEqual(['coches', 'bicicletas', 'muebles']);
    // Queda registrado quién guardó.
    expect(row?.updatedById).toBeTruthy();
  });

  it('sigue habiendo UNA sola fila tras varios guardados', async () => {
    await patch(body({ heroStaticTitle: 'Uno' })).expect(200);
    await patch(body({ heroStaticTitle: 'Dos' })).expect(200);
    expect(await prisma.homepageConfig.count()).toBe(1);
  });

  it('hero sin opciones rotativas es válido (título estático, sin animación)', async () => {
    const res = await patch(body({ heroRotatingOptions: [] })).expect(200);
    expect(res.body.heroRotatingOptions).toEqual([]);
  });

  it('omitir heroSubtitle lo BORRA (el cuerpo es un reemplazo completo)', async () => {
    await patch(body({ heroSubtitle: 'Algo' })).expect(200);
    const res = await patch(body()).expect(200);
    expect(res.body.heroSubtitle).toBeNull();
  });

  it('deja auditoría del guardado', async () => {
    await patch(body({ heroStaticTitle: 'Auditado' })).expect(200);
    const log = await prisma.auditLog.findFirst({
      where: { action: 'HOMEPAGE_CONFIG_UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).toBeTruthy();
    expect(log?.resourceId).toBe('singleton');
  });

  // ── Hero: validación ───────────────────────────────────────────────────────

  it('7 opciones rotativas → 400 (el tope de 6 es el límite del rotativo CSS)', async () => {
    await patch(
      body({ heroRotatingOptions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
    ).expect(400);
  });

  it('6 opciones rotativas → 200 (el tope exacto sí entra)', async () => {
    const res = await patch(
      body({ heroRotatingOptions: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    ).expect(200);
    expect(res.body.heroRotatingOptions).toHaveLength(6);
  });

  it('velocidad por debajo del mínimo → 400', async () => {
    await patch(body({ heroRotationMs: 200 })).expect(400);
  });

  it('velocidad por encima del máximo → 400', async () => {
    await patch(body({ heroRotationMs: 60000 })).expect(400);
  });

  it('título del hero vacío → 400', async () => {
    await patch(body({ heroStaticTitle: '' })).expect(400);
  });

  it('título del hero solo con espacios → 400 (no basta con @IsNotEmpty)', async () => {
    await patch(body({ heroStaticTitle: '   ' })).expect(400);
  });

  it('título del hero ausente → 400 (la portada siempre tiene <h1>)', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/homepage')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ blocks: [] })
      .expect(400);
  });

  // ── Bloques: los 2 tipos de RP.1 ───────────────────────────────────────────

  it('bloque cta válido → 200 y conserva el discriminador `type`', async () => {
    const res = await patch(
      body({ blocks: [{ id: 'b1', type: 'cta', label: 'Publica gratis', href: '/publicar' }] }),
    ).expect(200);
    expect(res.body.blocks).toEqual([
      { id: 'b1', type: 'cta', label: 'Publica gratis', href: '/publicar' },
    ]);
  });

  it('bloque cta con href absoluto y estilo → 200', async () => {
    const res = await patch(
      body({
        blocks: [
          { id: 'b1', type: 'cta', label: 'Ver', href: 'https://example.com', style: 'outline' },
        ],
      }),
    ).expect(200);
    expect(res.body.blocks[0].style).toBe('outline');
  });

  it('bloque search válido → 200', async () => {
    const res = await patch(
      body({
        blocks: [
          { id: 'b1', type: 'search', eyebrow: 'Miles de anuncios', showPopularCategories: true, popularCount: 6 },
        ],
      }),
    ).expect(200);
    expect(res.body.blocks[0]).toMatchObject({ type: 'search', popularCount: 6 });
  });

  it('los dos tipos juntos, en orden → 200 y el orden es la posición del array', async () => {
    const res = await patch(
      body({
        blocks: [
          { id: 'b1', type: 'search' },
          { id: 'b2', type: 'cta', label: 'Publicar', href: '/publicar' },
        ],
      }),
    ).expect(200);
    expect(res.body.blocks.map((b: { id: string }) => b.id)).toEqual(['b1', 'b2']);
  });

  // ── Bloques: validación de campo ───────────────────────────────────────────

  it('cta con href javascript: → 400', async () => {
    await patch(
      body({ blocks: [{ id: 'b1', type: 'cta', label: 'X', href: 'javascript:alert(1)' }] }),
    ).expect(400);
  });

  it('cta sin label → 400', async () => {
    await patch(body({ blocks: [{ id: 'b1', type: 'cta', href: '/publicar' }] })).expect(400);
  });

  it('cta con style desconocido → 400', async () => {
    await patch(
      body({ blocks: [{ id: 'b1', type: 'cta', label: 'X', href: '/x', style: 'neon' }] }),
    ).expect(400);
  });

  it('bloque sin id → 400', async () => {
    await patch(body({ blocks: [{ type: 'cta', label: 'X', href: '/x' }] })).expect(400);
  });

  it('bloque con propiedad extra → 400 (forbidNonWhitelisted)', async () => {
    await patch(
      body({ blocks: [{ id: 'b1', type: 'cta', label: 'X', href: '/x', evil: 'sí' }] }),
    ).expect(400);
  });

  it('search con popularCount fuera de rango → 400', async () => {
    await patch(body({ blocks: [{ id: 'b1', type: 'search', popularCount: 99 }] })).expect(400);
  });

  it('tipo de bloque aún no registrado (grid, RP.4) → 400', async () => {
    // El discriminador solo conoce los tipos con DTO. Nada entra en `blocks`
    // sin una clase que lo valide campo a campo.
    await patch(body({ blocks: [{ id: 'b1', type: 'grid', columns: 3 }] })).expect(400);
  });

  it('tipo de bloque inexistente → 400', async () => {
    await patch(body({ blocks: [{ id: 'b1', type: 'noExiste' }] })).expect(400);
  });

  // ── Bloques: reglas cruzadas del servicio ──────────────────────────────────

  it('dos bloques search → 400 (regla cruzada, no cabe en un decorador)', async () => {
    await patch(
      body({ blocks: [{ id: 'b1', type: 'search' }, { id: 'b2', type: 'search' }] }),
    ).expect(400);
  });

  it('dos bloques con el mismo id → 400', async () => {
    await patch(
      body({
        blocks: [
          { id: 'dup', type: 'cta', label: 'A', href: '/a' },
          { id: 'dup', type: 'cta', label: 'B', href: '/b' },
        ],
      }),
    ).expect(400);
  });

  // ── Nada rechazado se escribe ──────────────────────────────────────────────

  it('un cuerpo rechazado NO modifica la config guardada', async () => {
    await patch(
      body({ heroStaticTitle: 'Estado bueno', blocks: [{ id: 'ok', type: 'cta', label: 'A', href: '/a' }] }),
    ).expect(200);

    await patch(
      body({ heroStaticTitle: 'Estado malo', blocks: [{ id: 'x', type: 'cta', label: 'B', href: 'javascript:1' }] }),
    ).expect(400);

    const row = await prisma.homepageConfig.findUnique({ where: { id: 'singleton' } });
    expect(row?.heroStaticTitle).toBe('Estado bueno');
    expect(row?.blocks).toEqual([{ id: 'ok', type: 'cta', label: 'A', href: '/a' }]);
  });
});
