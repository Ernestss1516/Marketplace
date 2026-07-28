/**
 * FORMATOS DE PRECIO — RP.1 (backend: modelo + validación): política de
 * formatos de precio por categoría (Category.allowedPriceUnits) y validación
 * de Listing.priceUnit contra ella.
 *
 * Categorías propias (pup-*), creadas ANTES de app.init() — misma disciplina de
 * setup que listing-type-policy.e2e-spec.ts, del que este fichero es un calco:
 * FilterableAttributesResolver memoiza su mapa al arrancar, así que cualquier
 * categoría con datos debe existir antes.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

const PUP_SLUGS = [
  'pup-sin-config',
  'pup-horas',
  'pup-multi',
  'pup-padre-mes',
  'pup-hijo-hereda',
  'pup-padre-venta',
  'pup-hijo-alquiler',
  'pup-grandfather',
];

function listingPayload(
  title: string,
  categoryId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    title,
    description: `Descripción de prueba para "${title}"`,
    price: 100,
    type: 'SERVICE',
    priceType: 'FIXED',
    categoryId,
    city: 'Madrid',
    province: 'Madrid',
    ...extra,
  };
}

describe('Política de formato de precio por categoría (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let sellerToken: string;

  let catSinConfigId: string;
  let catHorasId: string;
  let catMultiId: string;
  let catPadreMesId: string;
  let catHijoHeredaId: string;
  let catPadreVentaId: string;
  let catHijoAlquilerId: string;
  let catGrandfatherId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await cleanDb(prisma);
    await prisma.category.deleteMany({ where: { slug: { in: PUP_SLUGS } } });

    // Sin configuración → efectivo [ONE_TIME] (default global).
    const catSinConfig = await prisma.category.create({
      data: { name: 'PUP Sin Config', slug: 'pup-sin-config', order: 920 },
    });
    catSinConfigId = catSinConfig.id;

    // Solo por horas — ni siquiera admite pago único.
    const catHoras = await prisma.category.create({
      data: {
        name: 'PUP Horas', slug: 'pup-horas', order: 921,
        allowedPriceUnits: ['PER_HOUR'],
      },
    });
    catHorasId = catHoras.id;

    // Varios formatos, incluido ONE_TIME.
    const catMulti = await prisma.category.create({
      data: {
        name: 'PUP Multi', slug: 'pup-multi', order: 922,
        allowedPriceUnits: ['ONE_TIME', 'PER_HOUR', 'PER_SESSION'],
      },
    });
    catMultiId = catMulti.id;

    // Herencia: padre PER_MONTH, hija sin config propia → hereda PER_MONTH.
    const catPadreMes = await prisma.category.create({
      data: {
        name: 'PUP Padre Mes', slug: 'pup-padre-mes', order: 923,
        allowedPriceUnits: ['PER_MONTH'],
      },
    });
    catPadreMesId = catPadreMes.id;
    const catHijoHereda = await prisma.category.create({
      data: { name: 'PUP Hijo Hereda', slug: 'pup-hijo-hereda', order: 1, parentId: catPadreMesId },
    });
    catHijoHeredaId = catHijoHereda.id;

    // Override total (el caso Inmobiliaria → Alquiler del diseño): la hija ofrece
    // un formato que el padre NO permite. Legítimo, no es contradicción.
    const catPadreVenta = await prisma.category.create({
      data: {
        name: 'PUP Padre Venta', slug: 'pup-padre-venta', order: 924,
        allowedPriceUnits: ['ONE_TIME'],
      },
    });
    catPadreVentaId = catPadreVenta.id;
    const catHijoAlquiler = await prisma.category.create({
      data: {
        name: 'PUP Hijo Alquiler', slug: 'pup-hijo-alquiler', order: 1,
        parentId: catPadreVentaId, allowedPriceUnits: ['PER_MONTH'],
      },
    });
    catHijoAlquilerId = catHijoAlquiler.id;

    // Para el escenario de grandfathering: nace SIN restringir (como todas las
    // categorías de hoy) y se restringe DESPUÉS de publicar un anuncio en ella.
    const catGrandfather = await prisma.category.create({
      data: { name: 'PUP Grandfather', slug: 'pup-grandfather', order: 925 },
    });
    catGrandfatherId = catGrandfather.id;

    app = await createTestApp();
    await app.init();

    await prisma.user.create({
      data: {
        email: 'pup-seller@example.com',
        name: 'PUP Seller',
        slug: 'pup-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'pup-seller@example.com', password: 'Test1234!' });
    sellerToken = loginRes.body.accessToken as string;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Categoría sin configurar: solo pago único (compatibilidad) ───────────

  it('categoría sin config → acepta ONE_TIME explícito', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Sofá PUP', catSinConfigId, { priceUnit: 'ONE_TIME' }))
      .expect(201);
  });

  it('categoría sin config → rechaza PER_HOUR con 422 (el default global es solo [ONE_TIME])', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Clases PUP', catSinConfigId, { priceUnit: 'PER_HOUR' }))
      .expect(422);
  });

  it('COMPATIBILIDAD: crear SIN enviar priceUnit → 201 y el anuncio queda en ONE_TIME', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Mesa PUP sin formato', catSinConfigId))
      .expect(201);

    const saved = await prisma.listing.findUnique({ where: { id: res.body.id } });
    expect(saved?.priceUnit).toBe('ONE_TIME');
  });

  // ── Categoría con formatos propios ───────────────────────────────────────

  it('categoría [PER_HOUR] acepta PER_HOUR', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Fontanero PUP', catHorasId, { priceUnit: 'PER_HOUR' }))
      .expect(201);
  });

  it('categoría [PER_HOUR] rechaza ONE_TIME con 422 — restringir excluye también el pago único', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Fontanero PUP fijo', catHorasId, { priceUnit: 'ONE_TIME' }))
      .expect(422);
  });

  it('categoría [PER_HOUR] rechaza también un alta que OMITE priceUnit (equivale a ONE_TIME)', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Fontanero PUP sin formato', catHorasId))
      .expect(422);
  });

  it('categoría con varios formatos los acepta todos y rechaza los que no lista', async () => {
    for (const unit of ['ONE_TIME', 'PER_HOUR', 'PER_SESSION']) {
      await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(listingPayload(`Multi PUP ${unit}`, catMultiId, { priceUnit: unit }))
        .expect(201);
    }

    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Multi PUP mes', catMultiId, { priceUnit: 'PER_MONTH' }))
      .expect(422);
  });

  it('un formato que no existe en el enum → 400 del DTO, no 422', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Multi PUP inventado', catMultiId, { priceUnit: 'PER_FORTNIGHT' }))
      .expect(400);
  });

  // ── Herencia ─────────────────────────────────────────────────────────────

  it('hija sin config propia hereda los formatos del padre → acepta PER_MONTH', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Piso PUP heredado', catHijoHeredaId, { priceUnit: 'PER_MONTH' }))
      .expect(201);
  });

  it('hija sin config propia hereda del padre → rechaza ONE_TIME con 422', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Piso PUP heredado fijo', catHijoHeredaId, { priceUnit: 'ONE_TIME' }))
      .expect(422);
  });

  it('OVERRIDE TOTAL: la hija acepta su propio formato aunque el padre NO lo permita (Inmobiliaria [ONE_TIME] → Alquiler [PER_MONTH])', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Alquiler PUP', catHijoAlquilerId, { priceUnit: 'PER_MONTH' }))
      .expect(201);
  });

  it('OVERRIDE TOTAL: la hija NO hereda además los del padre — no hay fusión', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Alquiler PUP venta', catHijoAlquilerId, { priceUnit: 'ONE_TIME' }))
      .expect(422);
  });

  it('el padre conserva su propia política, sin verse afectado por la de la hija', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Venta PUP', catPadreVentaId, { priceUnit: 'ONE_TIME' }))
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Venta PUP mes', catPadreVentaId, { priceUnit: 'PER_MONTH' }))
      .expect(422);
  });

  // ── Edición ──────────────────────────────────────────────────────────────

  describe('edición', () => {
    let listingId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(listingPayload('Multi PUP editable', catMultiId, { priceUnit: 'ONE_TIME' }))
        .expect(201);
      listingId = res.body.id as string;
    });

    it('PATCH a un formato permitido por la categoría → 200 y se persiste', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${listingId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ priceUnit: 'PER_SESSION' })
        .expect(200);

      const saved = await prisma.listing.findUnique({ where: { id: listingId } });
      expect(saved?.priceUnit).toBe('PER_SESSION');
    });

    it('PATCH a un formato NO permitido → 422 y el anuncio conserva el anterior', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${listingId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ priceUnit: 'PER_MONTH' })
        .expect(422);

      const saved = await prisma.listing.findUnique({ where: { id: listingId } });
      expect(saved?.priceUnit).toBe('PER_SESSION');
    });

    it('mover el anuncio a una categoría que no admite su formato → 422', async () => {
      // El anuncio está en PER_SESSION; pup-horas solo admite PER_HOUR.
      await request(app.getHttpServer())
        .patch(`/api/listings/${listingId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ categoryId: catHorasId })
        .expect(422);
    });
  });

  // ── GRANDFATHERING (el requisito de oro) ─────────────────────────────────

  describe('grandfathering: anuncio publicado antes de que el admin restrinja la categoría', () => {
    let oldListingId: string;

    beforeAll(async () => {
      // 1) El anuncio nace cuando la categoría no está configurada → ONE_TIME.
      const res = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(listingPayload('Anuncio PUP antiguo', catGrandfatherId))
        .expect(201);
      oldListingId = res.body.id as string;

      // 2) DESPUÉS, la categoría pasa a admitir solo PER_HOUR — el anuncio queda
      //    con un formato que su categoría ya no permitiría hoy.
      await prisma.category.update({
        where: { id: catGrandfatherId },
        data: { allowedPriceUnits: ['PER_HOUR'] },
      });
    });

    it('editar SOLO el título sigue funcionando (no se revalida el formato)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${oldListingId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ title: 'Anuncio PUP antiguo reeditado' })
        .expect(200);
    });

    it('editar SOLO el precio sigue funcionando', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${oldListingId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ price: 250 })
        .expect(200);
    });

    it('el anuncio conserva su formato original tras esas ediciones', async () => {
      const saved = await prisma.listing.findUnique({ where: { id: oldListingId } });
      expect(saved?.priceUnit).toBe('ONE_TIME');
    });

    it('pero si el usuario TOCA el formato, sí se valida contra la política vigente → 422', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${oldListingId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ priceUnit: 'ONE_TIME' })
        .expect(422);
    });

    it('y puede corregirlo a un formato ya permitido → 200', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${oldListingId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ priceUnit: 'PER_HOUR' })
        .expect(200);
    });
  });

  // ── Lectura pública: GET /categories/:slug ───────────────────────────────

  describe('GET /categories/:slug — allowedPriceUnits resuelto', () => {
    it('categoría sin config → ["ONE_TIME"] (default global, no lista vacía)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/categories/pup-sin-config')
        .expect(200);
      expect(res.body.allowedPriceUnits).toEqual(['ONE_TIME']);
    });

    it('categoría con config propia → se refleja tal cual', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/categories/pup-multi')
        .expect(200);
      expect(res.body.allowedPriceUnits).toEqual(['ONE_TIME', 'PER_HOUR', 'PER_SESSION']);
    });

    it('hija sin config propia → devuelve los del padre ya resueltos', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/categories/pup-hijo-hereda')
        .expect(200);
      expect(res.body.allowedPriceUnits).toEqual(['PER_MONTH']);
    });

    it('hija con config propia → override total, sin mezclar con los del padre', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/categories/pup-hijo-alquiler')
        .expect(200);
      expect(res.body.allowedPriceUnits).toEqual(['PER_MONTH']);
    });

    it('sigue devolviendo attributeSchema, allowedListingType y allowedViews (no se rompió lo existente)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/categories/pup-multi')
        .expect(200);
      expect(res.body.attributeSchema).toBeDefined();
      expect(res.body.allowedListingType).toBe('BOTH');
      expect(res.body.allowedViews).toEqual(['LISTA', 'AMPLIADA', 'MAPA']);
    });
  });
});
