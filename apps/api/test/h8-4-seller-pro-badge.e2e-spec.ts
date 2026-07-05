/**
 * H8.4 — Badge "Pro" en el perfil público del vendedor (e2e)
 *
 * Verifica que GET /users/:slug (UsersService.findBySlug) devuelve isPro,
 * calculado con EntitlementService.isProActive(seller.id) — un único cálculo
 * por perfil (no hay N+1: es un vendedor, no un listado).
 */

import { INestApplication } from '@nestjs/common';
import { EntitlementType, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('H8.4 — GET /users/:slug isPro (badge Pro)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function createUser(suffix: string) {
    return prisma.user.create({
      data: {
        email: `h84-${suffix}@example.com`,
        name: `H84 ${suffix}`,
        slug: `h84-${suffix}`,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
  }

  it('vendedor Pro (PRO_SUBSCRIPTION activo) → isPro:true', async () => {
    const user = await createUser('pro');
    await prisma.entitlement.create({
      data: {
        userId: user.id,
        type: EntitlementType.PRO_SUBSCRIPTION,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app.getHttpServer()).get(`/api/users/${user.slug}`).expect(200);
    expect(res.body.isPro).toBe(true);
    expect(res.body.name).toBe(user.name);
  });

  it('vendedor no-Pro → isPro:false', async () => {
    const user = await createUser('nopro');

    const res = await request(app.getHttpServer()).get(`/api/users/${user.slug}`).expect(200);
    expect(res.body.isPro).toBe(false);
  });

  it('vendedor con PRO_SUBSCRIPTION caducado → isPro:false (no cuenta un Pro vencido)', async () => {
    const user = await createUser('expired');
    await prisma.entitlement.create({
      data: {
        userId: user.id,
        type: EntitlementType.PRO_SUBSCRIPTION,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app.getHttpServer()).get(`/api/users/${user.slug}`).expect(200);
    expect(res.body.isPro).toBe(false);
  });

  it('vendedor con PRO_SUBSCRIPTION revocado (revokedAt) → isPro:false', async () => {
    const user = await createUser('revoked');
    await prisma.entitlement.create({
      data: {
        userId: user.id,
        type: EntitlementType.PRO_SUBSCRIPTION,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        revokedAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer()).get(`/api/users/${user.slug}`).expect(200);
    expect(res.body.isPro).toBe(false);
  });

  it('no expone el id interno del usuario en el perfil público', async () => {
    const user = await createUser('noid');

    const res = await request(app.getHttpServer()).get(`/api/users/${user.slug}`).expect(200);
    expect(res.body.id).toBeUndefined();
  });
});
