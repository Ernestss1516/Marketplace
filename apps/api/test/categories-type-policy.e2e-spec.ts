/**
 * CAMBIO PRODUCTO/SERVICIO — RÁFAGA 3 (wizard): GET /categories/:slug expone
 * allowedListingType ya resuelto (mismo patrón que attributeSchema con
 * resolveEffectiveSchema), para que el wizard sepa si debe preguntar el tipo.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

describe('GET /categories/:slug — allowedListingType resuelto (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let seq = 0;
  function uniqueSlug(prefix: string) {
    seq += 1;
    return `${prefix}-${Date.now()}-${seq}`;
  }

  it('categoría raíz sin política propia → BOTH (default)', async () => {
    const slug = uniqueSlug('ctp3-root-both');
    await prisma.category.create({ data: { name: 'CTP3 Root Both', slug, order: 990 } });

    const res = await request(app.getHttpServer()).get(`/api/categories/${slug}`).expect(200);
    expect(res.body.allowedListingType).toBe('BOTH');
  });

  it('categoría raíz con política propia PRODUCT_ONLY → se refleja tal cual', async () => {
    const slug = uniqueSlug('ctp3-root-po');
    await prisma.category.create({
      data: { name: 'CTP3 Root ProductOnly', slug, order: 991, allowedListingType: 'PRODUCT_ONLY' },
    });

    const res = await request(app.getHttpServer()).get(`/api/categories/${slug}`).expect(200);
    expect(res.body.allowedListingType).toBe('PRODUCT_ONLY');
  });

  it('hijo sin política propia hereda la del padre (SERVICE_ONLY)', async () => {
    const parent = await prisma.category.create({
      data: { name: 'CTP3 Parent Service', slug: uniqueSlug('ctp3-parent-so'), order: 992, allowedListingType: 'SERVICE_ONLY' },
    });
    const childSlug = uniqueSlug('ctp3-child-inherit');
    await prisma.category.create({
      data: { name: 'CTP3 Child Inherit', slug: childSlug, order: 1, parentId: parent.id },
    });

    const res = await request(app.getHttpServer()).get(`/api/categories/${childSlug}`).expect(200);
    expect(res.body.allowedListingType).toBe('SERVICE_ONLY');
  });

  it('hijo con política propia BOTH bajo un padre restringido → prevalece la del padre (BOTH es neutro)', async () => {
    const parent = await prisma.category.create({
      data: { name: 'CTP3 Parent Product', slug: uniqueSlug('ctp3-parent-po'), order: 993, allowedListingType: 'PRODUCT_ONLY' },
    });
    const childSlug = uniqueSlug('ctp3-child-both');
    await prisma.category.create({
      data: { name: 'CTP3 Child Both', slug: childSlug, order: 1, parentId: parent.id, allowedListingType: 'BOTH' },
    });

    const res = await request(app.getHttpServer()).get(`/api/categories/${childSlug}`).expect(200);
    expect(res.body.allowedListingType).toBe('PRODUCT_ONLY');
  });

  it('sigue devolviendo attributeSchema resuelto junto a allowedListingType (no se rompió lo existente)', async () => {
    const parent = await prisma.category.create({
      data: {
        name: 'CTP3 Parent Schema', slug: uniqueSlug('ctp3-parent-schema'), order: 994,
        attributeSchema: [{ name: 'year', label: 'Año', type: 'number', filterable: true, required: true }],
      },
    });
    const childSlug = uniqueSlug('ctp3-child-schema');
    await prisma.category.create({
      data: {
        name: 'CTP3 Child Schema', slug: childSlug, order: 1, parentId: parent.id,
        attributeSchema: [{ name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false }],
      },
    });

    const res = await request(app.getHttpServer()).get(`/api/categories/${childSlug}`).expect(200);
    expect(res.body.allowedListingType).toBe('BOTH');
    const names = (res.body.attributeSchema as { name: string }[]).map((f) => f.name);
    expect(names).toEqual(['year', 'brand']);
  });
});
