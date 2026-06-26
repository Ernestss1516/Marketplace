/**
 * RF.7-A — Active listing limits (e2e)
 *
 * Verifies that publish() and renew() enforce per-plan active listing limits
 * read from Setting (freeActiveListingLimit / proActiveListingLimit).
 *
 * Also verifies the publishedAt preservation fix in renew(): the original
 * publication date must survive a renewal (no free-bump side effect).
 */

import { INestApplication } from '@nestjs/common';
import { EntitlementType, ListingStatus, PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function loginUser(
  app: INestApplication,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  return res.body.accessToken as string;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RF.7-A — Active listing limits (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = cat.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function createUser(suffix: string) {
    const email = `rf7-${suffix}@example.com`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `RF7 ${suffix}`,
        slug: `rf7-${suffix}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const token = await loginUser(app, email, 'Test1234!');
    return { user, token };
  }

  async function seedActiveListings(userId: string, count: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const l = await prisma.listing.create({
        data: {
          title: `Active listing ${i}`,
          slug: `active-rf7-${userId.slice(-6)}-${i}-${Date.now()}`,
          description: 'desc',
          price: new Prisma.Decimal('10.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: ListingStatus.ACTIVE,
          sellerId: userId,
          categoryId,
          publishedAt: new Date(Date.now() - i * 1000), // staggered for ordering
        },
      });
      ids.push(l.id);
    }
    return ids;
  }

  async function createDraftViaApi(token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Draft listing RF7',
        description: 'desc',
        price: 10,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId,
        city: 'Madrid',
        province: 'Madrid',
        latitude: 40.4168,
        longitude: -3.7038,
      })
      .expect(201);
    return res.body.id as string;
  }

  async function grantProEntitlement(userId: string): Promise<void> {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        expiresAt: futureDate,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // FREE plan — publish limit
  // ---------------------------------------------------------------------------

  describe('Free plan publish limit (default 5)', () => {
    it('allows publishing when under the free limit', async () => {
      const { user, token } = await createUser('free-under');
      await seedActiveListings(user.id, 4); // 4 active → still room

      const draftId = await createDraftViaApi(token);
      await request(app.getHttpServer())
        .post(`/api/listings/${draftId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('returns 403 when the free user already has 5 active listings', async () => {
      const { user, token } = await createUser('free-at-limit');
      await seedActiveListings(user.id, 5); // exactly at limit

      const draftId = await createDraftViaApi(token);
      const res = await request(app.getHttpServer())
        .post(`/api/listings/${draftId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(res.body.message).toMatch(/5/); // limit number in message
    });

    it('allows publishing again after one active listing is sold', async () => {
      const { user, token } = await createUser('free-sell-slot');
      const activeIds = await seedActiveListings(user.id, 5); // at limit

      // Sell one listing to free up a slot
      await prisma.listing.update({
        where: { id: activeIds[0] },
        data: { status: ListingStatus.SOLD },
      });

      const draftId = await createDraftViaApi(token);
      await request(app.getHttpServer())
        .post(`/api/listings/${draftId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  // ---------------------------------------------------------------------------
  // PRO plan — publish limit
  // ---------------------------------------------------------------------------

  describe('Pro plan publish limit (default 20)', () => {
    it('allows a Pro user to publish when under the pro limit', async () => {
      const { user, token } = await createUser('pro-under');
      await grantProEntitlement(user.id);
      await seedActiveListings(user.id, 19); // 19 active, limit is 20

      const draftId = await createDraftViaApi(token);
      await request(app.getHttpServer())
        .post(`/api/listings/${draftId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('returns 403 when a Pro user already has 20 active listings', async () => {
      const { user, token } = await createUser('pro-at-limit');
      await grantProEntitlement(user.id);
      await seedActiveListings(user.id, 20);

      const draftId = await createDraftViaApi(token);
      const res = await request(app.getHttpServer())
        .post(`/api/listings/${draftId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(res.body.message).toMatch(/20/);
    });

    it('free user cannot publish 6th but becomes Pro and then can', async () => {
      const { user, token } = await createUser('free-upgrade-pro');
      await seedActiveListings(user.id, 5); // at free limit

      const draftId = await createDraftViaApi(token);

      // Still free → 403
      await request(app.getHttpServer())
        .post(`/api/listings/${draftId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      // Grant Pro subscription
      await grantProEntitlement(user.id);

      // Now Pro → 200
      await request(app.getHttpServer())
        .post(`/api/listings/${draftId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  // ---------------------------------------------------------------------------
  // renew() — limit applies + publishedAt preservation
  // ---------------------------------------------------------------------------

  describe('renew() enforces limit and preserves publishedAt', () => {
    it('returns 403 when renewing would exceed the free limit', async () => {
      const { user, token } = await createUser('renew-limit');
      await seedActiveListings(user.id, 5); // at limit

      // Create an EXPIRED listing
      const expired = await prisma.listing.create({
        data: {
          title: 'Expired listing for renew',
          slug: `expired-renew-${Date.now()}`,
          description: 'desc',
          price: new Prisma.Decimal('10.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: ListingStatus.EXPIRED,
          sellerId: user.id,
          categoryId,
          publishedAt: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        },
      });

      await request(app.getHttpServer())
        .post(`/api/listings/${expired.id}/renew`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('preserves the original publishedAt after renewal (no free bump)', async () => {
      const { user, token } = await createUser('renew-publishedat');
      // Only 0 active, so renewal is allowed

      const originalDate = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000);
      const expired = await prisma.listing.create({
        data: {
          title: 'Expired listing publishedAt check',
          slug: `expired-publishedat-${Date.now()}`,
          description: 'desc',
          price: new Prisma.Decimal('10.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: ListingStatus.EXPIRED,
          sellerId: user.id,
          categoryId,
          publishedAt: originalDate,
          expiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        },
      });

      const renewRes = await request(app.getHttpServer())
        .post(`/api/listings/${expired.id}/renew`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(renewRes.body.status).toBe('ACTIVE');

      // publishedAt must be the original date, not "now"
      const returnedPublishedAt = new Date(renewRes.body.publishedAt as string).getTime();
      const diff = Math.abs(returnedPublishedAt - originalDate.getTime());
      expect(diff).toBeLessThan(1000); // within 1 second of original

      // expiresAt must be approximately now + 60 days
      const expiresAt = new Date(renewRes.body.expiresAt as string).getTime();
      expect(expiresAt).toBeGreaterThan(Date.now() + 59 * 24 * 60 * 60 * 1000);
      expect(expiresAt).toBeLessThan(Date.now() + 61 * 24 * 60 * 60 * 1000);
    });
  });
});
