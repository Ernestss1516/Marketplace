/**
 * BÚSQUEDA+TAGS — RÁFAGA A4: la colisión de nombres se cierra en la CONFIGURACIÓN.
 *
 * Desde A4, `km_min=50000` en una búsqueda significa "km >= 50000". Si además
 * existiera un atributo llamado literalmente `km_min`, la misma clave querría decir
 * dos cosas: el parser mira la clave literal primero, así que ganaría el atributo y el
 * rango de `km` quedaría en la sombra sin que nadie se entere.
 *
 * Se rechaza al GUARDAR, con un 400 que lo explica — mismo criterio que
 * `RESERVED_ROOT_SLUGS` en A1 y que `RESERVED_ATTRIBUTE_NAMES` en el resolver:
 * el sitio de un choque de nombres es la configuración, no el tiempo de búsqueda.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

const attr = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
  name, label: name, type, filterable: true, required: false, ...extra,
});

describe('Admin — colisión de nombres con el sufijo de rango (A4, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  const creadas: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();

    await prisma.user.upsert({
      where: { email: 'arsc-admin@example.com' },
      create: {
        email: 'arsc-admin@example.com', name: 'ARSC Admin', slug: 'arsc-admin',
        passwordHash: await bcrypt.hash('Test1234!', 4), emailVerified: true, role: 'ADMIN',
      },
      update: {},
    });
    const res = await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: 'arsc-admin@example.com', password: 'Test1234!' });
    adminToken = res.body.accessToken as string;
  }, 30_000);

  afterAll(async () => {
    if (creadas.length) {
      await prisma.category.deleteMany({ where: { slug: { in: creadas } } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  function crear(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  const slug = (p: string) => {
    const s = `arsc-${p}-${Date.now()}`;
    creadas.push(s);
    return s;
  };

  it('RECHAZA crear `km_min` junto a un `km` numérico', async () => {
    const res = await crear({
      name: 'ARSC choque', slug: slug('choque'),
      attributeSchema: [attr('km', 'number'), attr('km_min', 'text')],
    }).expect(400);

    expect(JSON.stringify(res.body)).toMatch(/km_min/);
    expect(JSON.stringify(res.body)).toMatch(/rango/i);
  });

  it('RECHAZA también `km_max`', async () => {
    await crear({
      name: 'ARSC choque max', slug: slug('choque-max'),
      attributeSchema: [attr('km', 'number'), attr('km_max', 'text')],
    }).expect(400);
  });

  it('RECHAZA la colisión en la otra dirección: el `_min` ya existe y se añade el número', async () => {
    // El orden en el array no importa: lo que se comprueba es el conjunto.
    await crear({
      name: 'ARSC inverso', slug: slug('inverso'),
      attributeSchema: [attr('sqm_min', 'text'), attr('sqm', 'number')],
    }).expect(400);
  });

  it('PERMITE `algo_min` si NO existe un `algo` numérico — no es un veto al sufijo', async () => {
    // El sufijo por sí solo no molesta: solo choca cuando hay un número con esa base.
    const s = slug('libre');
    await crear({
      name: 'ARSC libre', slug: s,
      attributeSchema: [attr('presupuesto_min', 'text')],
    }).expect(201);
  });

  it('PERMITE `algo_min` si `algo` existe pero NO es numérico', async () => {
    // `color` es un select: `color_min` no puede confundirse con un rango, porque el
    // parser rechaza rangos sobre lo que no es número.
    const s = slug('no-numerico');
    await crear({
      name: 'ARSC no numérico', slug: s,
      attributeSchema: [attr('color', 'select', { options: ['Rojo'] }), attr('color_min', 'text')],
    }).expect(201);
  });

  it('la colisión se detecta también contra el schema HEREDADO del padre', async () => {
    const padreSlug = slug('padre');
    const padre = await crear({
      name: 'ARSC padre', slug: padreSlug,
      attributeSchema: [attr('anio', 'number')],
    }).expect(201);

    // La hija no declara `anio`, pero lo hereda: `anio_min` choca igual.
    await crear({
      name: 'ARSC hija', slug: slug('hija'),
      parentId: (padre.body as { id: string }).id,
      attributeSchema: [attr('anio_min', 'text')],
    }).expect(400);
  });

  it('al EDITAR también se comprueba, no solo al crear', async () => {
    const s = slug('editar');
    const creada = await crear({
      name: 'ARSC editar', slug: s,
      attributeSchema: [attr('peso', 'number')],
    }).expect(201);

    await request(app.getHttpServer())
      .patch(`/api/admin/categories/${(creada.body as { id: string }).id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ attributeSchema: [attr('peso', 'number'), attr('peso_max', 'text')] })
      .expect(400);
  });

  it('un schema normal se sigue guardando sin fricción (la guarda no es un muro)', async () => {
    await crear({
      name: 'ARSC normal', slug: slug('normal'),
      attributeSchema: [attr('km', 'number'), attr('cambio', 'select', { options: ['Manual'] })],
    }).expect(201);
  });
});
