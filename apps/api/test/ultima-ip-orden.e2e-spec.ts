/**
 * ÚLTIMA IP (5b) — VERLA: el orden, los filtros y el índice.
 *
 * Tres cosas, y una de ellas es una barrera contra un peligro que se comprobó a mano:
 *
 *  1. **El orden por defecto de `/admin/usuarios` es la última conexión**, y los que
 *     NUNCA han entrado van al FINAL. Sin `nulls: 'last'` irían arriba —Postgres pone los
 *     NULL primero en `DESC`—, o sea justo lo contrario de lo que se ha pedido.
 *  2. **Los filtros por IP** devuelven lo suyo, en usuarios y en anuncios.
 *  3. **EL ÍNDICE EXISTE Y EL PLAN LO USA.** Vive en SQL a mano porque Prisma no sabe
 *     expresar `NULLS LAST`, y se verificó que `prisma migrate dev` lo ve como DRIFT y
 *     genera un `DROP INDEX`. Esta barrera convierte esa pérdida silenciosa en un rojo de
 *     CI. Ver el comentario de `20260822090000_indice_ultima_conexion/migration.sql`.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Última IP 5b — orden, filtros e índice (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let categoryId: string;
  let idReciente: string;
  let idAntiguo: string;
  let idNunca: string;

  const server = () => app.getHttpServer();

  async function crearUsuario(
    sufijo: string,
    lastLoginAt: Date | null,
    lastLoginIp: string | null,
  ) {
    const passwordHash = await bcrypt.hash('Test1234!', 10);
    return prisma.user.create({
      data: {
        email: `orden-${sufijo}@example.com`,
        name: `Orden ${sufijo}`,
        slug: `orden-${sufijo}`,
        passwordHash,
        emailVerified: true,
        lastLoginAt,
        lastLoginIp,
      },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    await prisma.user.create({
      data: {
        email: 'orden-admin@example.com', name: 'Orden Admin', slug: 'orden-admin',
        passwordHash, emailVerified: true, role: 'ADMIN',
      },
    });

    // El ADMIN entra por su puerta, así que su `lastLoginAt` queda a AHORA — por eso los
    // tres de abajo se sitúan en el pasado y en el futuro relativo a él con margen.
    adminToken = (
      await request(server()).post('/api/auth/admin-login').send({
        email: 'orden-admin@example.com', password: 'Test1234!',
      })
    ).body.accessToken as string;

    const ahora = Date.now();
    idReciente = (
      await crearUsuario('reciente', new Date(ahora + 60 * 60 * 1000), '10.0.0.7')
    ).id;
    idAntiguo = (
      await crearUsuario('antiguo', new Date(ahora - 90 * 24 * 60 * 60 * 1000), '10.0.0.8')
    ).id;
    // NUNCA ha entrado: `lastLoginAt` NULL. Es el que la barrera vigila.
    idNunca = (await crearUsuario('nunca', null, null)).id;

    categoryId = (
      await prisma.category.create({
        data: { name: 'Orden Cat', slug: 'orden-cat', attributeSchema: [] },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const listarUsuarios = (qs = '') =>
    request(server())
      .get(`/api/admin/users${qs}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

  // ───────────────────────────────────────────────────────────────────────────
  // 1 — EL ORDEN, y los NULL al final
  // ───────────────────────────────────────────────────────────────────────────

  it('LA BARRERA: ordena por última conexión, y quien NUNCA entró va al FINAL', async () => {
    const res = await listarUsuarios('?perPage=100');
    const ids: string[] = res.body.items.map((u: { id: string }) => u.id);

    const posReciente = ids.indexOf(idReciente);
    const posAntiguo = ids.indexOf(idAntiguo);
    const posNunca = ids.indexOf(idNunca);

    expect(posReciente).toBeGreaterThanOrEqual(0);
    // Más reciente antes que más antiguo: el orden es el que se pidió.
    expect(posReciente).toBeLessThan(posAntiguo);
    // Y LA MITAD QUE IMPORTA: el que nunca ha entrado va DESPUÉS de los dos.
    // Sin `nulls: 'last'` estaría el PRIMERO de toda la lista, porque Postgres pone los
    // NULL delante en un `ORDER BY ... DESC`. Es el fallo que sólo se ve en producción.
    expect(posNunca).toBeGreaterThan(posAntiguo);
  });

  it('el orden inverso también deja a los que nunca entraron al final', async () => {
    const res = await listarUsuarios('?perPage=100&order=last-login-asc');
    const ids: string[] = res.body.items.map((u: { id: string }) => u.id);
    expect(ids.indexOf(idAntiguo)).toBeLessThan(ids.indexOf(idReciente));
    expect(ids.indexOf(idNunca)).toBeGreaterThan(ids.indexOf(idReciente));
  });

  it('el orden por alta sigue existiendo (era el de siempre, no se pierde)', async () => {
    const res = await listarUsuarios('?perPage=100&order=oldest');
    const ids: string[] = res.body.items.map((u: { id: string }) => u.id);
    // `orden-admin` se creó el primero de los cuatro.
    expect(ids.length).toBeGreaterThan(3);
    const admin = res.body.items.find(
      (u: { email: string }) => u.email === 'orden-admin@example.com',
    );
    expect(ids.indexOf(admin.id)).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2 — LOS FILTROS POR IP
  // ───────────────────────────────────────────────────────────────────────────

  it('filtrar usuarios por IP devuelve sólo los de esa IP', async () => {
    const res = await listarUsuarios('?ip=10.0.0.7');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(idReciente);
    expect(res.body.items[0].lastLoginIp).toBe('10.0.0.7');
  });

  it('y es coincidencia EXACTA, no «contiene»', async () => {
    // Una IP es un identificador, no un texto que se busque por partes. Con `contains`,
    // buscar «10.0.0.7» traería también «110.0.0.70» — y en una investigación de
    // multicuenta eso no es un falso positivo cualquiera: es señalar a quien no es.
    await crearUsuario('parecido', new Date(), '110.0.0.70');
    const res = await listarUsuarios('?ip=10.0.0.7');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(idReciente);
  });

  it('filtrar ANUNCIOS por la IP de gestión de su dueño', async () => {
    const propio = await prisma.listing.create({
      data: {
        title: 'Orden anuncio ip', slug: `orden-anuncio-ip-${Date.now()}`,
        description: 'x', price: 1, type: 'PRODUCT', status: 'ACTIVE',
        sellerId: idReciente, categoryId, lastOwnerIp: '10.0.0.7',
        lastOwnerInteractionAt: new Date(),
      },
    });
    await prisma.listing.create({
      data: {
        title: 'Orden anuncio otro', slug: `orden-anuncio-otro-${Date.now()}`,
        description: 'x', price: 1, type: 'PRODUCT', status: 'ACTIVE',
        sellerId: idAntiguo, categoryId, lastOwnerIp: '10.0.0.8',
        lastOwnerInteractionAt: new Date(),
      },
    });

    const res = await request(server())
      .get('/api/admin/listings?ip=10.0.0.7')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(propio.id);
  });

  it('el filtro por IP se COMBINA con los demás ejes (F2 no cambia de forma)', async () => {
    const res = await listarUsuarios('?ip=10.0.0.7&status=ACTIVE');
    expect(res.body.items).toHaveLength(1);
    const vacio = await listarUsuarios('?ip=10.0.0.7&status=BANNED');
    expect(vacio.body.items).toHaveLength(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3 — EL ÍNDICE: existe, y el plan lo usa
  // ───────────────────────────────────────────────────────────────────────────

  it('LA BARRERA ANTI-DRIFT: el índice de la última conexión EXISTE', async () => {
    // Vive en SQL a mano porque Prisma no sabe expresar `NULLS LAST`, y se COMPROBÓ que
    // `prisma migrate dev` lo ve como drift y propone borrarlo. Sin este test, esa
    // pérdida sería silenciosa: la pantalla seguiría funcionando, sólo que recorriendo la
    // tabla entera en cada carga.
    const filas = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'User_lastLoginAt_desc_nulls_last_idx'`,
    );
    expect(filas).toHaveLength(1);
    // Y con la FORMA correcta: un índice DESC a secas (NULLS FIRST) no sirve para esta
    // consulta — medido. Ver el comentario de la migración.
    expect(filas[0].indexdef).toContain('DESC NULLS LAST');
  });

  it('y el plan del orden por defecto NO lleva un Sort', async () => {
    // El molde de F2: lo que se fija es la FORMA del plan —qué índice es utilizable y si
    // aparece un `Sort`—, que es estructural y no depende del volumen.
    const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN SELECT id FROM "User" ORDER BY "lastLoginAt" DESC NULLS LAST LIMIT 24`,
    );
    const texto = plan.map((f) => f['QUERY PLAN']).join('\n');
    expect(texto).toContain('User_lastLoginAt_desc_nulls_last_idx');
    expect(texto).not.toContain('Sort');
  });
});
