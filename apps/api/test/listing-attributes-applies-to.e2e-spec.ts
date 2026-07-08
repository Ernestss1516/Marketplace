/**
 * CAMBIO PRODUCTO/SERVICIO — RÁFAGA 5 (verificación integral): bug real
 * encontrado al ejercitar un flujo transversal (Playwright) que ninguna
 * batería aislada de R1/R3 tocaba con un backend real.
 *
 * ListingsService.validateAttributes() comprobaba los campos `required: true`
 * contra el schema efectivo SIN filtrar por `appliesTo`/tipo del anuncio — a
 * diferencia del wizard, que sí filtra (filterSchemaByType) antes de decidir
 * qué es obligatorio y qué atributos enviar. Consecuencia real: cualquier
 * categoría con un atributo `required: true` restringido a un tipo (p. ej.
 * appliesTo: ['SERVICE']) rechazaba SIEMPRE con 422 los anuncios del tipo
 * contrario (PRODUCT), aunque el wizard construyera el payload correctamente
 * (nunca envía ese campo para el tipo que no aplica).
 *
 * Fix: create() y update() ahora filtran el schema efectivo por el tipo del
 * anuncio (dto.type en create; el type ya fijado — inmutable — en update)
 * antes de pasarlo a validateAttributes()/validateLinkedSelects().
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

describe('required + appliesTo: el filtro por tipo se respeta al validar (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();

    const category = await prisma.category.create({
      data: {
        name: 'LAAT Categoría',
        slug: `laat-cat-${Date.now()}`,
        order: 997,
        attributeSchema: [
          { name: 'comun', label: 'Común', type: 'text', filterable: false, required: false },
          {
            name: 'soloProducto', label: 'Solo Producto', type: 'text',
            filterable: false, required: true, appliesTo: ['PRODUCT'],
          },
          {
            name: 'soloServicio', label: 'Solo Servicio', type: 'text',
            filterable: false, required: true, appliesTo: ['SERVICE'],
          },
        ],
      },
    });
    categoryId = category.id;

    app = await createTestApp();
    await app.init();

    const email = `laat-seller-${Date.now()}@example.com`;
    await prisma.user.create({
      data: {
        email, name: 'LAAT Seller', slug: `laat-seller-${Date.now()}`,
        passwordHash: await bcrypt.hash('Test1234!', 4), emailVerified: true,
      },
    });
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Test1234!' });
    token = res.body.accessToken as string;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function listingPayload(title: string, type: 'PRODUCT' | 'SERVICE', attributes: Record<string, unknown>) {
    return {
      title,
      description: `Descripción de prueba para "${title}"`,
      price: 100,
      type,
      ...(type === 'PRODUCT' ? { condition: 'GOOD' } : {}),
      priceType: 'FIXED',
      categoryId,
      attributes,
      city: 'Madrid',
      province: 'Madrid',
    };
  }

  it('PRODUCT sin el campo required-solo-SERVICE → 201 (el required de SERVICE no aplica aquí)', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${token}`)
      .send(listingPayload('LAAT Producto sin servicio', 'PRODUCT', { comun: 'x', soloProducto: 'y' }))
      .expect(201);
  });

  it('SERVICE sin el campo required-solo-PRODUCT → 201 (el required de PRODUCT no aplica aquí)', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${token}`)
      .send(listingPayload('LAAT Servicio sin producto', 'SERVICE', { comun: 'x', soloServicio: 'y' }))
      .expect(201);
  });

  it('PRODUCT SIN su propio required (soloProducto) → sigue dando 422 (el filtro por tipo no anula la exigencia dentro del mismo tipo)', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${token}`)
      .send(listingPayload('LAAT Producto incompleto', 'PRODUCT', { comun: 'x' }))
      .expect(422);
  });

  it('SERVICE SIN su propio required (soloServicio) → sigue dando 422', async () => {
    await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${token}`)
      .send(listingPayload('LAAT Servicio incompleto', 'SERVICE', { comun: 'x' }))
      .expect(422);
  });

  describe('update() aplica el mismo filtro (type inmutable, se usa el ya fijado)', () => {
    let listingId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${token}`)
        .send(listingPayload('LAAT Producto a editar', 'PRODUCT', { comun: 'x', soloProducto: 'y' }))
        .expect(201);
      listingId = res.body.id as string;
    });

    it('actualizar solo "comun" en un PRODUCT no exige soloServicio → 200', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${listingId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ attributes: { comun: 'x2' } })
        .expect(200);
    });
  });
});
