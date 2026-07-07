/**
 * CAMBIO PRODUCTO/SERVICIO — RÁFAGA 1 (modelo): política de tipo por categoría
 * + inmutabilidad de Listing.type.
 *
 * Categorías propias (ltp-*), creadas ANTES de app.init() — igual que se
 * reordenó en rc5-attributes.e2e-spec.ts / rc5b-vehiculos.e2e-spec.ts durante
 * RÁFAGA 0: FilterableAttributesResolver memoiza su mapa al arrancar, así que
 * cualquier categoría con datos que la búsqueda deba ver debe existir antes.
 * Aquí no se ejercita búsqueda, pero se mantiene la misma disciplina de setup
 * por consistencia y para no reintroducir la misma clase de fallo frágil.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

const LTP_SLUGS = [
  'ltp-producto-only',
  'ltp-servicio-only',
  'ltp-ambos',
  'ltp-padre-producto',
  'ltp-hijo-hereda',
  'ltp-padre-ambos',
  'ltp-hijo-restringe',
];

function listingPayload(
  title: string,
  type: 'PRODUCT' | 'SERVICE',
  categoryId: string,
) {
  return {
    title,
    description: `Descripción de prueba para "${title}"`,
    price: 100,
    type,
    priceType: 'FIXED',
    ...(type === 'PRODUCT' ? { condition: 'GOOD' } : {}),
    categoryId,
    city: 'Madrid',
    province: 'Madrid',
  };
}

describe('Política de tipo por categoría + inmutabilidad de Listing.type (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let sellerToken: string;

  let catProductOnlyId: string;
  let catServiceOnlyId: string;
  let catBothId: string;
  let catParentProductId: string;
  let catChildInheritId: string;
  let catParentBothId: string;
  let catChildRestrictId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await cleanDb(prisma);
    await prisma.category.deleteMany({ where: { slug: { in: LTP_SLUGS } } });

    const catProductOnly = await prisma.category.create({
      data: { name: 'LTP Producto Only', slug: 'ltp-producto-only', order: 900, allowedListingType: 'PRODUCT_ONLY' },
    });
    catProductOnlyId = catProductOnly.id;

    const catServiceOnly = await prisma.category.create({
      data: { name: 'LTP Servicio Only', slug: 'ltp-servicio-only', order: 901, allowedListingType: 'SERVICE_ONLY' },
    });
    catServiceOnlyId = catServiceOnly.id;

    const catBoth = await prisma.category.create({
      data: { name: 'LTP Ambos', slug: 'ltp-ambos', order: 902 }, // allowedListingType default BOTH
    });
    catBothId = catBoth.id;

    // Herencia: padre PRODUCT_ONLY, hijo sin política propia (BOTH por defecto) → hereda PRODUCT_ONLY.
    const catParentProduct = await prisma.category.create({
      data: { name: 'LTP Padre Producto', slug: 'ltp-padre-producto', order: 903, allowedListingType: 'PRODUCT_ONLY' },
    });
    catParentProductId = catParentProduct.id;
    const catChildInherit = await prisma.category.create({
      data: { name: 'LTP Hijo Hereda', slug: 'ltp-hijo-hereda', order: 1, parentId: catParentProductId },
    });
    catChildInheritId = catChildInherit.id;

    // El hijo puede restringir MÁS que el padre: padre BOTH, hijo SERVICE_ONLY.
    const catParentBoth = await prisma.category.create({
      data: { name: 'LTP Padre Ambos', slug: 'ltp-padre-ambos', order: 904 },
    });
    catParentBothId = catParentBoth.id;
    const catChildRestrict = await prisma.category.create({
      data: {
        name: 'LTP Hijo Restringe',
        slug: 'ltp-hijo-restringe',
        order: 1,
        parentId: catParentBothId,
        allowedListingType: 'SERVICE_ONLY',
      },
    });
    catChildRestrictId = catChildRestrict.id;

    app = await createTestApp();
    await app.init();

    await prisma.user.create({
      data: {
        email: 'ltp-seller@example.com',
        name: 'LTP Seller',
        slug: 'ltp-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'ltp-seller@example.com', password: 'Test1234!' });
    sellerToken = loginRes.body.accessToken as string;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Política directa ────────────────────────────────────────────────────

  it('categoría PRODUCT_ONLY rechaza un anuncio SERVICE con 422', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Clases de guitarra', 'SERVICE', catProductOnlyId))
      .expect(422);
  });

  it('categoría PRODUCT_ONLY acepta un anuncio PRODUCT', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Bicicleta de montaña LTP', 'PRODUCT', catProductOnlyId))
      .expect(201);
  });

  it('categoría SERVICE_ONLY rechaza un anuncio PRODUCT con 422', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Silla de oficina LTP', 'PRODUCT', catServiceOnlyId))
      .expect(422);
  });

  it('categoría SERVICE_ONLY acepta un anuncio SERVICE', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Reparación de ordenadores LTP', 'SERVICE', catServiceOnlyId))
      .expect(201);
  });

  it('categoría BOTH (default) acepta PRODUCT y SERVICE', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Mesa de comedor LTP', 'PRODUCT', catBothId))
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Clases de yoga LTP', 'SERVICE', catBothId))
      .expect(201);
  });

  // ── Herencia ─────────────────────────────────────────────────────────────

  it('hijo sin política propia hereda la restricción del padre (PRODUCT_ONLY) → rechaza SERVICE', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Clases de repostería LTP', 'SERVICE', catChildInheritId))
      .expect(422);
  });

  it('hijo sin política propia hereda PRODUCT_ONLY del padre → acepta PRODUCT', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Sofá de tres plazas LTP', 'PRODUCT', catChildInheritId))
      .expect(201);
  });

  it('hijo puede restringir más que el padre (padre BOTH, hijo SERVICE_ONLY) → rechaza PRODUCT', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Lavadora LTP', 'PRODUCT', catChildRestrictId))
      .expect(422);
  });

  it('hijo con restricción propia (SERVICE_ONLY) acepta SERVICE aunque el padre sea BOTH', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Fontanería a domicilio LTP', 'SERVICE', catChildRestrictId))
      .expect(201);
  });

  // ── Inmutabilidad de Listing.type ───────────────────────────────────────

  describe('type es inmutable tras crear', () => {
    let listingId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(listingPayload('Anuncio Inmutable LTP', 'PRODUCT', catBothId))
        .expect(201);
      listingId = res.body.id as string;
    });

    it('PATCH con type en el body → 400 (no es un campo reconocido del DTO)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${listingId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ type: 'SERVICE' })
        .expect(400);
    });

    it('el anuncio conserva su type original tras el intento de PATCH', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/listings/mine/${listingId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      expect(res.body.type).toBe('PRODUCT');
    });

    it('PATCH sin type (otros campos) sigue funcionando con normalidad', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${listingId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ title: 'Anuncio Inmutable LTP (editado)' })
        .expect(200);
    });
  });

  // ── categoryId puede cambiar, pero el type (inmutable) debe seguir permitido ──

  it('mover un anuncio PRODUCT a una categoría SERVICE_ONLY vía PATCH categoryId → 422', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Anuncio a mover LTP', 'PRODUCT', catBothId))
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/listings/${createRes.body.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ categoryId: catServiceOnlyId })
      .expect(422);
  });
});
