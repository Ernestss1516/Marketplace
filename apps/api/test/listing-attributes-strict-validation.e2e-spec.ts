/**
 * REFUERZO DE VALIDACIÓN DE ATRIBUTOS — cierra la asimetría entre selects
 * vinculados (ya validados desde R5) y el resto de atributos (hasta ahora
 * solo `required` se comprobaba). Añade: opciones de select plano, tipo de
 * dato (number/boolean), claves desconocidas.
 *
 * create(): validación COMPLETA — no hay "existing" con el que calcular un
 * delta, crear exige que todo el bag sea correcto.
 *
 * update(): SOLO el delta (lo que cambia en ESTA petición) se somete al
 * refuerzo — grandfathering por construcción para datos sucios preexistentes
 * (medidos en la ráfaga anterior: 8 anuncios reales, todos basura de dev en
 * `brand`/Coches). `required` sigue sobre el bag completo, sin cambios.
 *
 * El caso "Cotce" (medido antes de diseñar): un anuncio con `marca` inválida
 * y `modelo` ya no resoluble contra ella. Sin el delta en validateLinkedSelects
 * este refuerzo rompería la edición de CUALQUIER campo de ese anuncio — el
 * mismo guard de R5 ya tenía este problema, no solo los planos nuevos.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

const ATTRIBUTE_SCHEMA = [
  { name: 'requerido', label: 'Requerido', type: 'text', filterable: false, required: true },
  { name: 'color', label: 'Color', type: 'select', options: ['Rojo', 'Azul', 'Verde'], filterable: false, required: false },
  { name: 'potencia', label: 'Potencia', type: 'number', filterable: false, required: false },
  { name: 'climatizado', label: 'Climatizado', type: 'boolean', filterable: false, required: false },
  {
    name: 'soloProducto', label: 'Solo Producto', type: 'select', options: ['X', 'Y'],
    filterable: false, required: false, appliesTo: ['PRODUCT'],
  },
  { name: 'marca', label: 'Marca', type: 'select', options: ['Seat', 'Toyota'], filterable: false, required: false },
  {
    name: 'modelo', label: 'Modelo', type: 'select', dependsOn: 'marca', filterable: false, required: false,
    optionsByParent: { Seat: ['Ibiza', 'León'], Toyota: ['Corolla'] },
  },
];

describe('Refuerzo de validación de atributos: create() completo, update() delta (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let sellerId: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();

    const category = await prisma.category.create({
      data: {
        name: 'LASV Categoría',
        slug: `lasv-cat-${Date.now()}`,
        order: 996,
        attributeSchema: ATTRIBUTE_SCHEMA,
      },
    });
    categoryId = category.id;

    app = await createTestApp();
    await app.init();

    const email = `lasv-seller-${Date.now()}@example.com`;
    const seller = await prisma.user.create({
      data: {
        email, name: 'LASV Seller', slug: `lasv-seller-${Date.now()}`,
        passwordHash: await bcrypt.hash('Test1234!', 4), emailVerified: true,
      },
    });
    sellerId = seller.id;
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Test1234!' });
    token = res.body.accessToken as string;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let seq = 0;
  function uniqueTitle(prefix: string) {
    seq += 1;
    return `${prefix} ${Date.now()}-${seq}`;
  }

  function basePayload(attributes: Record<string, unknown>, type: 'PRODUCT' | 'SERVICE' = 'PRODUCT') {
    return {
      title: uniqueTitle('LASV'),
      description: 'Descripción de prueba para validación reforzada.',
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

  // ── create() — validación COMPLETA ────────────────────────────────────────

  describe('create()', () => {
    it('control positivo: todos los valores válidos → 201', async () => {
      await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${token}`)
        .send(basePayload({ requerido: 'x', color: 'Rojo', potencia: 5, climatizado: true }))
        .expect(201);
    });

    it('select plano fuera de options → 422', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${token}`)
        .send(basePayload({ requerido: 'x', color: 'Amarillo' }))
        .expect(422);
      expect(JSON.stringify(res.body.message)).toMatch(/Amarillo/);
    });

    it('number no numérico → 422', async () => {
      await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${token}`)
        .send(basePayload({ requerido: 'x', potencia: 'no-numero' }))
        .expect(422);
    });

    it('boolean no booleano → 422', async () => {
      await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${token}`)
        .send(basePayload({ requerido: 'x', climatizado: 'quizas' }))
        .expect(422);
    });

    it('clave desconocida → 422', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${token}`)
        .send(basePayload({ requerido: 'x', noExiste: 'valor' }))
        .expect(422);
      expect(JSON.stringify(res.body.message)).toMatch(/noExiste/);
    });

    it('required ausente → 422 (comportamiento preexistente, sigue funcionando)', async () => {
      await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${token}`)
        .send(basePayload({ color: 'Rojo' }))
        .expect(422);
    });

    it('coherencia con R5: un select solo-PRODUCT no se exige/valida en un anuncio SERVICE', async () => {
      await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${token}`)
        .send(basePayload({ requerido: 'x' }, 'SERVICE'))
        .expect(201);
    });

    it('coherencia con R5: ese mismo select SÍ se valida en un anuncio PRODUCT', async () => {
      await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${token}`)
        .send(basePayload({ requerido: 'x', soloProducto: 'Z' }, 'PRODUCT'))
        .expect(422);
    });
  });

  // ── update() — SOLO delta para valores/vínculos; required sigue completo ──

  describe('update() — delta en selects planos', () => {
    let dirtyListingId: string;

    beforeAll(async () => {
      // Insertado DIRECTO por Prisma (no vía API — create() ya no lo permitiría):
      // simula un anuncio preexistente con `color` fuera del catálogo actual,
      // igual que los 8 anuncios reales medidos antes de diseñar.
      const listing = await prisma.listing.create({
        data: {
          title: uniqueTitle('LASV Sucio'),
          slug: `lasv-sucio-${Date.now()}`,
          description: 'Anuncio con color sucio preexistente.',
          price: 50,
          type: 'PRODUCT',
          condition: 'GOOD',
          priceType: 'FIXED',
          categoryId,
          sellerId,
          attributes: { requerido: 'x', color: 'Amarillo' },
        },
      });
      dirtyListingId = listing.id;
    });

    it('CASO CENTRAL: reenviar el bag completo con el color sucio IDÉNTICO + cambiar solo el precio → 200', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${dirtyListingId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ price: 999, attributes: { requerido: 'x', color: 'Amarillo' } })
        .expect(200);
    });

    it('cambiar el color sucio a un valor VÁLIDO → 200', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${dirtyListingId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ attributes: { requerido: 'x', color: 'Rojo' } })
        .expect(200);
    });

    it('cambiar el color a un valor INVÁLIDO → 422', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${dirtyListingId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ attributes: { requerido: 'x', color: 'Naranja' } })
        .expect(422);
    });

    it('anuncio LIMPIO: cambiar su color a un valor inválido → 422 (el refuerzo aplica igual a datos limpios)', async () => {
      const clean = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${token}`)
        .send(basePayload({ requerido: 'x', color: 'Rojo' }))
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/listings/${clean.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ attributes: { requerido: 'x', color: 'Naranja' } })
        .expect(422);
    });
  });

  describe('update() — delta en selects VINCULADOS (reproduce "Cotce")', () => {
    let brokenLinkedListingId: string;

    beforeAll(async () => {
      // marca inválida (fuera de options) + modelo que no resuelve contra ella
      // — exactamente el caso real medido ("Cotce": brand=Hyndai, model=i20).
      const listing = await prisma.listing.create({
        data: {
          title: uniqueTitle('LASV Vinculado Roto'),
          slug: `lasv-vinc-roto-${Date.now()}`,
          description: 'Anuncio con marca/modelo ya inconsistentes.',
          price: 50,
          type: 'PRODUCT',
          condition: 'GOOD',
          priceType: 'FIXED',
          categoryId,
          sellerId,
          attributes: { requerido: 'x', marca: 'Hyundai-no-listada', modelo: 'i20' },
        },
      });
      brokenLinkedListingId = listing.id;
    });

    it('HOY (sin delta) esto daría 422 — con el fix, reenviar el par idéntico + cambiar solo el precio → 200', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${brokenLinkedListingId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ price: 777, attributes: { requerido: 'x', marca: 'Hyundai-no-listada', modelo: 'i20' } })
        .expect(200);
    });

    it('cambiar el modelo explícitamente a uno inválido para la marca actual → 422 (el usuario SÍ tocó el campo)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${brokenLinkedListingId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ attributes: { requerido: 'x', marca: 'Hyundai-no-listada', modelo: 'Corolla' } })
        .expect(422);
    });

    it('arreglar el par completo (marca y modelo válidos y coherentes) → 200', async () => {
      await request(app.getHttpServer())
        .patch(`/api/listings/${brokenLinkedListingId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ attributes: { requerido: 'x', marca: 'Seat', modelo: 'Ibiza' } })
        .expect(200);
    });
  });
});
