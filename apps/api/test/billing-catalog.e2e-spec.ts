/**
 * RF.9 / RF.11 — GET /billing/catalog (public endpoint)
 *
 * Verifies:
 *   - Returns 200 without authentication
 *   - Returns { products, bumpCreditCost } shape
 *   - Each price has priceId, amount, currency — no gatewayPriceId exposed
 *   - Featured prices include durationDays + creditCost (from Setting)
 *   - bumpCreditCost is a number (from Setting bumpCreditCost, default 5)
 *   - Inactive products/prices are excluded
 *   - RECURRING (Pro) and ONE_TIME products are represented
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient, ProductType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

type CatalogResponse = {
  products: Record<string, unknown>[];
  bumpCreditCost: number;
};

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

  it('returns 200 without auth and { products, bumpCreditCost } shape', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/billing/catalog')
      .expect(200);

    const body = res.body as CatalogResponse;
    expect(Array.isArray(body.products)).toBe(true);
    expect(typeof body.bumpCreditCost).toBe('number');
    expect(body.bumpCreditCost).toBeGreaterThan(0);
  });

  it('returns active products with their active prices', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/billing/catalog')
      .expect(200);

    const { products } = res.body as CatalogResponse;
    expect(products.length).toBeGreaterThan(0);

    for (const product of products) {
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

    const { products } = res.body as CatalogResponse;
    const proProduct = products.find((p) => (p as { type: string }).type === 'RECURRING');
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

    const { products } = res.body as CatalogResponse;
    const creditPrices = products
      .flatMap((p) => (p as { prices: Record<string, unknown>[] }).prices)
      .filter((price) => price.creditAmount !== undefined);

    expect(creditPrices.length).toBeGreaterThan(0);
    for (const price of creditPrices) {
      expect(typeof price.creditAmount).toBe('number');
      expect(price.creditAmount as number).toBeGreaterThan(0);
    }
  });

  it('featured prices include durationDays and creditCost from Setting', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/billing/catalog')
      .expect(200);

    const { products } = res.body as CatalogResponse;
    const featuredPrices = products
      .flatMap((p) => (p as { prices: Record<string, unknown>[] }).prices)
      .filter((price) => price.durationDays !== undefined && price.creditAmount === undefined);

    expect(featuredPrices.length).toBeGreaterThan(0);

    for (const price of featuredPrices) {
      expect(typeof price.durationDays).toBe('number');
      expect(typeof price.creditCost).toBe('number');
      expect(price.creditCost as number).toBeGreaterThan(0);
    }

    // Validate specific seeded values (7d → 30 cr, 14d → 50 cr, 30d → 100 cr)
    const by7d = featuredPrices.find((p) => p.durationDays === 7);
    const by14d = featuredPrices.find((p) => p.durationDays === 14);
    const by30d = featuredPrices.find((p) => p.durationDays === 30);
    if (by7d) expect(by7d.creditCost).toBe(30);
    if (by14d) expect(by14d.creditCost).toBe(50);
    if (by30d) expect(by30d.creditCost).toBe(100);
  });

  it('bumpCreditCost matches the seeded Setting value', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/billing/catalog')
      .expect(200);

    const { bumpCreditCost } = res.body as CatalogResponse;
    // seed-test.ts seeds bumpCreditCost = 5
    expect(bumpCreditCost).toBe(5);
  });

  it('does not return inactive products', async () => {
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

    const { products } = res.body as CatalogResponse;
    const ids = products.map((p) => (p as { id: string }).id);
    expect(ids).not.toContain(inactive.id);

    await prisma.price.deleteMany({ where: { productId: inactive.id } });
    await prisma.product.delete({ where: { id: inactive.id } });
  });

  it('does not return inactive prices within an active product', async () => {
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

    const { products } = res.body as CatalogResponse;
    const recurringProduct = products.find(
      (p) => (p as { type: string }).type === 'RECURRING',
    );
    const priceIds = (recurringProduct as { prices: { priceId: string }[] }).prices.map(
      (p) => p.priceId,
    );
    expect(priceIds).not.toContain(inactivePrice.id);

    await prisma.price.delete({ where: { id: inactivePrice.id } });
  });
});
