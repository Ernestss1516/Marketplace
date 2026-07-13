/**
 * Feature teléfono en anuncios — botón "Ver teléfono".
 *
 * Decisiones de privacidad (no re-decidir, ver conversación):
 *  - El teléfono NUNCA viaja en el payload público de la ficha (GET /listings/:slug).
 *    Solo se sirve autenticado en GET /listings/:id/phone, con rate limit.
 *  - Listing.phone (publicado, opcional) es distinto de User.phone (privado, de cuenta).
 */

import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { RedisService } from 'src/infra/redis/redis.service';

describe('Teléfono en anuncios — "Ver teléfono" (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: RedisService;
  let categoryId: string;

  let sellerId: string;
  let sellerToken: string;
  let buyerToken: string;

  const hash = (pw: string) => bcrypt.hash(pw, 4);

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    redis = app.get(RedisService);
    await cleanDb(prisma);

    // Repeated local runs within the same hour must not inherit a previous
    // run's rate-limit counters (see feedback_ci_verde_repetido).
    const staleKeys = await redis.client.keys('phone:reveal:*');
    if (staleKeys.length > 0) await redis.client.del(...staleKeys);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const seller = await prisma.user.create({
      data: {
        email: 'phone-seller@example.com',
        name: 'Phone Seller',
        slug: 'phone-seller',
        passwordHash: await hash('Test1234!'),
        emailVerified: true,
      },
    });
    sellerId = seller.id;
    await prisma.user.create({
      data: {
        email: 'phone-buyer@example.com',
        name: 'Phone Buyer',
        slug: 'phone-buyer',
        passwordHash: await hash('Test1234!'),
        emailVerified: true,
      },
    });

    const sellerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'phone-seller@example.com', password: 'Test1234!' });
    sellerToken = sellerLogin.body.accessToken as string;

    const buyerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'phone-buyer@example.com', password: 'Test1234!' });
    buyerToken = buyerLogin.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let listingSeq = 0;
  /** ACTIVE listing created directly in Postgres — bypasses publish()/Meilisearch, not needed here. */
  async function createActiveListing(phone: string | null) {
    listingSeq += 1;
    return prisma.listing.create({
      data: {
        title: `Anuncio teléfono ${listingSeq}`,
        slug: `anuncio-telefono-${listingSeq}-${Date.now()}`,
        description: 'Anuncio de prueba para el botón Ver teléfono',
        price: new Prisma.Decimal('100.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'ACTIVE',
        sellerId,
        categoryId,
        publishedAt: new Date(),
        phone,
      },
    });
  }

  // ── Privacidad del payload público ──────────────────────────────────────────

  describe('GET /api/listings/:slug — el teléfono NUNCA viaja en el payload público', () => {
    it('anuncio CON teléfono → la respuesta no contiene el número, pero sí hasPhone: true', async () => {
      const listing = await createActiveListing('600111222');

      const res = await request(app.getHttpServer())
        .get(`/api/listings/${listing.slug}`)
        .expect(200);

      expect(res.body.hasPhone).toBe(true);
      expect(res.body.phone).toBeUndefined();
      // Prueba de privacidad explícita: el número en crudo no aparece en NINGUNA
      // parte del JSON servido a un anónimo.
      expect(JSON.stringify(res.body)).not.toContain('600111222');
    });

    it('anuncio SIN teléfono → hasPhone: false, sin botón que pintar', async () => {
      const listing = await createActiveListing(null);

      const res = await request(app.getHttpServer())
        .get(`/api/listings/${listing.slug}`)
        .expect(200);

      expect(res.body.hasPhone).toBe(false);
      expect(res.body.phone).toBeUndefined();
    });

    it('mismo resultado en cache HIT (2ª petición, servida desde Redis)', async () => {
      const listing = await createActiveListing('600333444');

      await request(app.getHttpServer()).get(`/api/listings/${listing.slug}`).expect(200);
      const cached = await request(app.getHttpServer())
        .get(`/api/listings/${listing.slug}`)
        .expect(200);

      expect(cached.body.hasPhone).toBe(true);
      expect(JSON.stringify(cached.body)).not.toContain('600333444');
    });
  });

  // ── GET /listings/:id/phone ───────────────────────────────────────────────

  describe('GET /api/listings/:id/phone', () => {
    it('sin autenticación → 401', async () => {
      const listing = await createActiveListing('611000000');
      await request(app.getHttpServer()).get(`/api/listings/${listing.id}/phone`).expect(401);
    });

    it('autenticado, anuncio con teléfono → 200 con el número', async () => {
      const listing = await createActiveListing('611222333');
      const res = await request(app.getHttpServer())
        .get(`/api/listings/${listing.id}/phone`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(200);
      expect(res.body).toEqual({ phone: '611222333' });
    });

    it('autenticado, anuncio SIN teléfono → 404', async () => {
      const listing = await createActiveListing(null);
      await request(app.getHttpServer())
        .get(`/api/listings/${listing.id}/phone`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(404);
    });

    it('anuncio no ACTIVE (DRAFT) con teléfono → 404, aunque el teléfono exista', async () => {
      listingSeq += 1;
      const draft = await prisma.listing.create({
        data: {
          title: `Anuncio borrador ${listingSeq}`,
          slug: `anuncio-borrador-${listingSeq}-${Date.now()}`,
          description: 'Borrador, no debe revelar teléfono',
          price: new Prisma.Decimal('50.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: 'DRAFT',
          sellerId,
          categoryId,
          phone: '699888777',
        },
      });
      await request(app.getHttpServer())
        .get(`/api/listings/${draft.id}/phone`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(404);
    });

    it('anuncio inexistente → 404', async () => {
      await request(app.getHttpServer())
        .get('/api/listings/xxxxxxxx-0000-0000-0000-000000000000/phone')
        .set('Authorization', `Bearer ${buyerToken}`)
        .expect(404);
    });
  });

  // ── Prerrelleno perfil → anuncio (creación) ─────────────────────────────────

  describe('Creación de anuncio con teléfono', () => {
    const draftPayload = (overrides: Record<string, unknown> = {}) => ({
      title: 'Bicicleta con teléfono',
      description: 'Anuncio de prueba con teléfono publicado',
      price: 120,
      type: 'PRODUCT',
      priceType: 'FIXED',
      condition: 'GOOD',
      categoryId,
      city: 'Madrid',
      province: 'Madrid',
      latitude: 40.4168,
      longitude: -3.7038,
      ...overrides,
    });

    it('POST /api/listings con phone → se persiste en el anuncio (no en el perfil)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(draftPayload({ phone: '622333444' }))
        .expect(201);

      const stored = await prisma.listing.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(stored.phone).toBe('622333444');

      const seller = await prisma.user.findUniqueOrThrow({ where: { id: sellerId } });
      // Publicar un teléfono en el anuncio NUNCA escribe en el perfil del usuario.
      expect(seller.phone).not.toBe('622333444');
    });

    it('POST /api/listings sin phone → el anuncio no tiene teléfono (nunca se publica por defecto)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(draftPayload())
        .expect(201);

      const stored = await prisma.listing.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(stored.phone).toBeNull();
    });

    it('phone con caracteres no válidos → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(draftPayload({ phone: 'no-es-un-telefono-valido!!' }))
        .expect(400);
    });

    it('phone de más de 20 caracteres → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(draftPayload({ phone: '1'.repeat(21) }))
        .expect(400);
    });

    it('PATCH /api/listings/:id con phone: "" → borra el teléfono publicado (deja de mostrarse)', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(draftPayload({ phone: '633444555' }))
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/listings/${created.body.id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ phone: '' })
        .expect(200);

      const stored = await prisma.listing.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(stored.phone).toBe('');
    });
  });

  // ── Perfil público del vendedor — el teléfono del USER nunca se expone ──────

  describe('Perfil público del vendedor', () => {
    it('GET /api/users/:slug nunca incluye el teléfono del perfil (privado)', async () => {
      await prisma.user.update({ where: { id: sellerId }, data: { phone: '644555666' } });

      const res = await request(app.getHttpServer())
        .get('/api/users/phone-seller')
        .expect(200);

      expect(res.body.phone).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('644555666');
    });
  });

  // ── Rate limit ───────────────────────────────────────────────────────────────
  // Al final del archivo: deja el contador del usuario por encima del límite
  // durante el resto de la hora — si corriera antes, otros tests con
  // buyerToken empezarían a recibir 429.

  describe('Rate limit — 30 revelaciones/hora por usuario', () => {
    it('la 31ª petición del mismo usuario en la hora → 429 con retryAfter', async () => {
      // Usuario propio, sin peticiones previas en esta misma hora — los tests
      // anteriores ya han consumido parte del cupo de buyerToken (incluidos
      // los 404, que también cuentan: el rate limit se comprueba ANTES de
      // tocar la BD, igual que en ContactService).
      await prisma.user.create({
        data: {
          email: 'phone-ratelimit@example.com',
          name: 'Phone Rate Limit',
          slug: 'phone-ratelimit',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
        },
      });
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'phone-ratelimit@example.com', password: 'Test1234!' });
      const rateLimitToken = login.body.accessToken as string;

      const listings = await Promise.all(
        Array.from({ length: 31 }, (_, i) => createActiveListing(`6${(700000 + i).toString().padStart(6, '0')}`)),
      );

      for (const listing of listings.slice(0, 30)) {
        await request(app.getHttpServer())
          .get(`/api/listings/${listing.id}/phone`)
          .set('Authorization', `Bearer ${rateLimitToken}`)
          .expect(200);
      }

      const res = await request(app.getHttpServer())
        .get(`/api/listings/${listings[30].id}/phone`)
        .set('Authorization', `Bearer ${rateLimitToken}`)
        .expect(429);

      expect(typeof res.body.retryAfter).toBe('number');
    });
  });
});
