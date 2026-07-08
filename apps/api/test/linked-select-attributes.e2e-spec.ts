/**
 * NUEVA FEATURE — selects vinculados (Marca/Modelo): guard de backend en
 * ListingsService.validateLinkedSelects, ejercitado a través de create() y
 * update(). Caso mínimo de demostración: brand (select plano) → model
 * (select vinculado, dependsOn: 'brand'), con 2 valores de A y 2-3 de B cada
 * uno — suficiente para probar reactividad + guard, no el catálogo completo.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

const LSA_SLUG = 'lsa-vehiculos';

const ATTRIBUTE_SCHEMA = [
  {
    name: 'brand',
    label: 'Marca',
    type: 'select',
    filterable: true,
    required: false,
    options: ['Seat', 'BMW'],
  },
  {
    name: 'model',
    label: 'Modelo',
    type: 'select',
    filterable: true,
    required: false,
    dependsOn: 'brand',
    optionsByParent: {
      Seat: ['Ibiza', 'León'],
      BMW: ['Serie 1', 'Serie 3'],
    },
  },
  {
    name: 'color',
    label: 'Color',
    type: 'select',
    filterable: false,
    required: false,
    options: ['Rojo', 'Azul'],
  },
];

function listingPayload(title: string, attributes: Record<string, unknown>, categoryId: string) {
  return {
    title,
    description: `Descripción de prueba para "${title}"`,
    price: 100,
    type: 'PRODUCT',
    condition: 'GOOD',
    priceType: 'FIXED',
    categoryId,
    attributes,
    city: 'Madrid',
    province: 'Madrid',
  };
}

describe('Selects vinculados (Marca/Modelo) — guard de backend (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let sellerToken: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await cleanDb(prisma);
    await prisma.category.deleteMany({ where: { slug: LSA_SLUG } });

    const category = await prisma.category.create({
      data: {
        name: 'LSA Vehículos',
        slug: LSA_SLUG,
        order: 950,
        attributeSchema: ATTRIBUTE_SCHEMA,
      },
    });
    categoryId = category.id;

    app = await createTestApp();
    await app.init();

    await prisma.user.create({
      data: {
        email: 'lsa-seller@example.com',
        name: 'LSA Seller',
        slug: 'lsa-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'lsa-seller@example.com', password: 'Test1234!' });
    sellerToken = loginRes.body.accessToken as string;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('brand + model válidos (model pertenece a las opciones de brand) → 201', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Seat Ibiza LSA', { brand: 'Seat', model: 'Ibiza' }, categoryId))
      .expect(201);
  });

  it('model presente pero brand ausente → 422 con mensaje claro ("requiere seleccionar")', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Modelo sin marca LSA', { model: 'Ibiza' }, categoryId))
      .expect(422);
    expect(JSON.stringify(res.body.message)).toMatch(/requiere seleccionar/i);
    expect(JSON.stringify(res.body.message)).toMatch(/Marca/);
  });

  it('model no pertenece a las opciones de la marca elegida → 422', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Marca/modelo cruzados LSA', { brand: 'Seat', model: 'Serie 3' }, categoryId))
      .expect(422);
  });

  it('solo brand, sin model → 201 (model no es required, solo vinculado)', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Solo marca LSA', { brand: 'BMW' }, categoryId))
      .expect(201);
  });

  it('un select plano (color) sin relación no se ve afectado por el guard', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send(listingPayload('Color plano LSA', { color: 'Rojo' }, categoryId))
      .expect(201);
  });

  describe('update() aplica el mismo guard (mergedAttrs)', () => {
    let listingId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(listingPayload('Anuncio a editar LSA', { brand: 'Seat', model: 'León' }, categoryId))
        .expect(201);
      listingId = res.body.id as string;
    });

    it('cambiar solo brand a un valor que invalida el model ya guardado → 422', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${listingId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ attributes: { brand: 'BMW' } })
        .expect(422);
    });

    it('cambiar brand y model juntos a una combinación válida → 200', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${listingId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ attributes: { brand: 'BMW', model: 'Serie 1' } })
        .expect(200);
    });
  });
});
