/**
 * RF.9 — GET /billing/catalog (public endpoint)
 *
 * Verifies:
 *   - Returns 200 without authentication
 *   - Returns an array of active products with their active prices
 *   - Each price has priceId, amount, currency — no gatewayPriceId exposed
 *   - Inactive products/prices are excluded
 *   - RECURRING (Pro) and ONE_TIME products are represented
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient, ProductType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('GET /billing/catalog (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = new PrismaClient();
    await app.init();
    // User data only — static seed (Product/Price/Category/Setting) is shared across workers
    await cleanDb(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('returns 200 without auth', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/billing/catalog')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns active products with their active prices', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/billing/catalog')
      .expect(200);

    const products: unknown[] = res.body;
    expect(products.length).toBeGreaterThan(0);

    for (const product of products as Record<string, unknown>[]) {
      expect(product).toHaveProperty('id');
      expect(product).toHaveProperty('name');
      expect(product).toHaveProperty('type');
      expect(product).toHaveProperty('prices');
      expect(Array.isArray(product.prices)).toBe(true);

      for (const price of product.prices as Record<string, unknown>[]) {
        expect(price).toHaveProperty('priceId');
        expect(price).toHaveProperty('amount');
        expect(price).toHaveProperty('currency');
        // gatewayPriceId MUST NOT be exposed
        expect(price).not.toHaveProperty('gatewayPriceId');
        // internal productId MUST NOT be exposed
        expect(price).not.toHaveProperty('productId');
      }
    }
  });

  it('includes the seeded RECURRING Plan Pro product with monthly and annual prices', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/billing/catalog')
      .expect(200);

    const proProduct = (res.body as Record<string, unknown>[]).find(
      (p) => (p as { type: string }).type === 'RECURRING',
    );
    expect(proProduct).toBeDefined();
    expect((proProduct as Record<string, unknown>).name).toBe('Plan Pro');

    const prices = (proProduct as { prices: Record<string, unknown>[] }).prices;
    expect(prices.length).toBeGreaterThanOrEqual(2);

    const monthly = prices.find((p) => p.interval === 'MONTH');
    const annual = prices.find((p) => p.interval === 'YEAR');
    expect(monthly).toBeDefined();
    expect(annual).toBeDefined();

    expect(typeof (monthly as Record<string, unknown>).priceId).toBe('string');
    expect(typeof (monthly as Record<string, unknown>).amount).toBe('number');
    expect((monthly as Record<string, unknown>).currency).toBe('EUR');
    expect((monthly as Record<string, unknown>).intervalCount).toBe(1);
  });

  it('includes creditAmount for credit pack prices', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/billing/catalog')
      .expect(200);

    const products = res.body as Record<string, unknown>[];
    const creditPrices = products
      .flatMap((p) => (p as { prices: Record<string, unknown>[] }).prices)
      .filter((price) => price.creditAmount !== undefined);

    expect(creditPrices.length).toBeGreaterThan(0);
    for (const price of creditPrices) {
      expect(typeof price.creditAmount).toBe('number');
      expect(price.creditAmount as number).toBeGreaterThan(0);
    }
  });

  it('does not return inactive products', async () => {
    // Create an inactive product with a price
    const inactive = await prisma.product.create({
      data: {
        name: 'Inactive Product',
        type: ProductType.ONE_TIME,
        active: false,
        prices: {
          create: {
            amount: new Prisma.Decimal('1.00'),
          },
        },
      },
    });

    const res = await request(app.getHttpServer())
      .get('/api/billing/catalog')
      .expect(200);

    const ids = (res.body as { id: string }[]).map((p) => p.id);
    expect(ids).not.toContain(inactive.id);

    // Cleanup (prices must be deleted before product due to FK constraint)
    await prisma.price.deleteMany({ where: { productId: inactive.id } });
    await prisma.product.delete({ where: { id: inactive.id } });
  });

  it('does not return inactive prices within an active product', async () => {
    // Add an inactive price to the Pro product
    const proProduct = await prisma.product.findFirst({
      where: { type: ProductType.RECURRING, active: true },
      select: { id: true },
    });
    expect(proProduct).not.toBeNull();

    const inactivePrice = await prisma.price.create({
      data: {
        productId: proProduct!.id,
        amount: new Prisma.Decimal('999.99'),
        interval: 'MONTH',
        intervalCount: 6,
        active: false,
      },
    });

    const res = await request(app.getHttpServer())
      .get('/api/billing/catalog')
      .expect(200);

    const recurringProduct = (res.body as Record<string, unknown>[]).find(
      (p) => (p as { type: string }).type === 'RECURRING',
    );
    const priceIds = (recurringProduct as { prices: { priceId: string }[] }).prices.map(
      (p) => p.priceId,
    );
    expect(priceIds).not.toContain(inactivePrice.id);

    // Cleanup
    await prisma.price.delete({ where: { id: inactivePrice.id } });
  });
});
