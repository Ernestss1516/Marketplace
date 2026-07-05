/**
 * H8 Bloque E — "Vendedor de confianza" (e2e)
 *
 * Verifica:
 *   - PATCH /admin/users/:id/trusted: ADMIN-only (ni USER ni MODERATOR pueden), con AuditLog.
 *   - GET /users/:slug (perfil público) devuelve trusted, independiente de isPro.
 *   - GET /listings/:slug (ficha del anuncio) devuelve seller.trusted.
 *   - Un usuario Pro Y trusted muestra ambos de forma independiente (uno no deriva del otro).
 */

import { INestApplication } from '@nestjs/common';
import { EntitlementType, ListingStatus, Prisma, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

async function loginUser(app: INestApplication, email: string, password: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
  return res.body.accessToken as string;
}

describe('H8 Bloque E — Vendedor de confianza (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;

  let adminToken: string;
  let userToken: string;
  let moderatorToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = cat.id;

    const passwordHash = await bcrypt.hash('Test1234!', 4);

    await prisma.user.create({
      data: {
        email: 'h8trust-admin@example.com',
        name: 'H8Trust Admin',
        slug: 'h8trust-admin',
        passwordHash,
        emailVerified: true,
        role: Role.ADMIN,
      },
    });
    adminToken = await loginUser(app, 'h8trust-admin@example.com', 'Test1234!');

    await prisma.user.create({
      data: {
        email: 'h8trust-mod@example.com',
        name: 'H8Trust Mod',
        slug: 'h8trust-mod',
        passwordHash,
        emailVerified: true,
        role: Role.MODERATOR,
      },
    });
    moderatorToken = await loginUser(app, 'h8trust-mod@example.com', 'Test1234!');

    await prisma.user.create({
      data: {
        email: 'h8trust-user@example.com',
        name: 'H8Trust User',
        slug: 'h8trust-user',
        passwordHash,
        emailVerified: true,
      },
    });
    userToken = await loginUser(app, 'h8trust-user@example.com', 'Test1234!');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createSeller(suffix: string) {
    return prisma.user.create({
      data: {
        email: `h8trust-${suffix}@example.com`,
        name: `H8Trust ${suffix}`,
        slug: `h8trust-${suffix}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
  }

  async function createActiveListing(sellerId: string, suffix: string) {
    return prisma.listing.create({
      data: {
        title: `H8Trust listing ${suffix}`,
        slug: `h8trust-listing-${suffix}-${Date.now()}`,
        description: 'desc',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        sellerId,
        categoryId,
        publishedAt: new Date(),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // PATCH /admin/users/:id/trusted
  // ---------------------------------------------------------------------------

  describe('PATCH /admin/users/:id/trusted', () => {
    it('ADMIN marca a un usuario como de confianza → 200 + AuditLog USER_TRUST', async () => {
      const seller = await createSeller('mark');

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/users/${seller.id}/trusted`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ trusted: true })
        .expect(200);

      expect(res.body.trusted).toBe(true);

      const log = await prisma.auditLog.findFirst({
        where: { resourceId: seller.id, action: 'USER_TRUST' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
      expect(log!.resourceType).toBe('User');
      expect((log!.before as { trusted: boolean }).trusted).toBe(false);
      expect((log!.after as { trusted: boolean }).trusted).toBe(true);
    });

    it('ADMIN desmarca a un usuario de confianza → 200 + AuditLog USER_UNTRUST', async () => {
      const seller = await createSeller('unmark');
      await prisma.user.update({ where: { id: seller.id }, data: { trusted: true } });

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/users/${seller.id}/trusted`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ trusted: false })
        .expect(200);

      expect(res.body.trusted).toBe(false);

      const log = await prisma.auditLog.findFirst({
        where: { resourceId: seller.id, action: 'USER_UNTRUST' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
      expect((log!.before as { trusted: boolean }).trusted).toBe(true);
      expect((log!.after as { trusted: boolean }).trusted).toBe(false);
    });

    it('USER (no-admin) → 403', async () => {
      const seller = await createSeller('forbidden-user');
      await request(app.getHttpServer())
        .patch(`/api/admin/users/${seller.id}/trusted`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ trusted: true })
        .expect(403);
    });

    it('MODERATOR → 403 (otorgar confianza es decisión de plataforma, no moderación)', async () => {
      const seller = await createSeller('forbidden-mod');
      await request(app.getHttpServer())
        .patch(`/api/admin/users/${seller.id}/trusted`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ trusted: true })
        .expect(403);
    });

    it('sin auth → 401', async () => {
      const seller = await createSeller('noauth');
      await request(app.getHttpServer())
        .patch(`/api/admin/users/${seller.id}/trusted`)
        .send({ trusted: true })
        .expect(401);
    });

    it('usuario inexistente → 404', async () => {
      await request(app.getHttpServer())
        .patch('/api/admin/users/nonexistent-id-xyz/trusted')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ trusted: true })
        .expect(404);
    });
  });

  // ---------------------------------------------------------------------------
  // Visibilidad pública: perfil del vendedor + ficha del anuncio
  // ---------------------------------------------------------------------------

  describe('Visibilidad pública de trusted', () => {
    it('GET /users/:slug de un vendedor de confianza → trusted:true', async () => {
      const seller = await createSeller('profile-trusted');
      await prisma.user.update({ where: { id: seller.id }, data: { trusted: true } });

      const res = await request(app.getHttpServer()).get(`/api/users/${seller.slug}`).expect(200);
      expect(res.body.trusted).toBe(true);
    });

    it('GET /users/:slug de un vendedor normal → trusted:false', async () => {
      const seller = await createSeller('profile-normal');

      const res = await request(app.getHttpServer()).get(`/api/users/${seller.slug}`).expect(200);
      expect(res.body.trusted).toBe(false);
    });

    it('GET /listings/:slug → seller.trusted refleja el estado del vendedor', async () => {
      const seller = await createSeller('listing-trusted');
      await prisma.user.update({ where: { id: seller.id }, data: { trusted: true } });
      const listing = await createActiveListing(seller.id, 'trusted');

      const res = await request(app.getHttpServer()).get(`/api/listings/${listing.slug}`).expect(200);
      expect(res.body.seller.trusted).toBe(true);
    });

    it('GET /listings/:slug de un vendedor normal → seller.trusted:false', async () => {
      const seller = await createSeller('listing-normal');
      const listing = await createActiveListing(seller.id, 'normal');

      const res = await request(app.getHttpServer()).get(`/api/listings/${listing.slug}`).expect(200);
      expect(res.body.seller.trusted).toBe(false);
    });

    it('CLAVE — un vendedor Pro Y de confianza muestra ambos de forma independiente', async () => {
      const seller = await createSeller('pro-and-trusted');
      await prisma.user.update({ where: { id: seller.id }, data: { trusted: true } });
      await prisma.entitlement.create({
        data: {
          userId: seller.id,
          type: EntitlementType.PRO_SUBSCRIPTION,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const res = await request(app.getHttpServer()).get(`/api/users/${seller.slug}`).expect(200);
      expect(res.body.isPro).toBe(true);
      expect(res.body.trusted).toBe(true);
    });

    it('trusted no se deriva de isPro: un Pro sin confianza otorgada sigue trusted:false', async () => {
      const seller = await createSeller('pro-not-trusted');
      await prisma.entitlement.create({
        data: {
          userId: seller.id,
          type: EntitlementType.PRO_SUBSCRIPTION,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const res = await request(app.getHttpServer()).get(`/api/users/${seller.slug}`).expect(200);
      expect(res.body.isPro).toBe(true);
      expect(res.body.trusted).toBe(false);
    });
  });
});
