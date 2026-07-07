/**
 * CAMBIO PRODUCTO/SERVICIO — RÁFAGA 2 (admin de categorías): validación de
 * escritura de la política de tipo, en ambas direcciones.
 *
 * No depende del orden de arranque de FilterableAttributesResolver (a
 * diferencia de RÁFAGA 0/1): estos endpoints leen Category directamente vía
 * Prisma, no a través del resolver memoizado — así que las categorías se
 * crean libremente dentro de cada test, sin necesidad de existir antes de
 * app.init().
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

describe('Admin — validación de escritura de allowedListingType (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let sellerToken: string;
  let sellerId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();

    const hash = (pw: string) => bcrypt.hash(pw, 4);
    const [admin, seller] = await Promise.all([
      prisma.user.upsert({
        where: { email: 'atp2-admin@example.com' },
        create: {
          email: 'atp2-admin@example.com', name: 'ATP2 Admin', slug: 'atp2-admin',
          passwordHash: await hash('Test1234!'), emailVerified: true, role: 'ADMIN',
        },
        update: {},
      }),
      prisma.user.upsert({
        where: { email: 'atp2-seller@example.com' },
        create: {
          email: 'atp2-seller@example.com', name: 'ATP2 Seller', slug: 'atp2-seller',
          passwordHash: await hash('Test1234!'), emailVerified: true,
        },
        update: {},
      }),
    ]);
    sellerId = seller.id;
    void admin;

    const [adminRes, sellerRes] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'atp2-admin@example.com', password: 'Test1234!' }),
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'atp2-seller@example.com', password: 'Test1234!' }),
    ]);
    adminToken = adminRes.body.accessToken as string;
    sellerToken = sellerRes.body.accessToken as string;
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

  function createCategory(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  function updateCategory(id: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/api/admin/categories/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  async function createListingDirect(categoryId: string, type: 'PRODUCT' | 'SERVICE') {
    return prisma.listing.create({
      data: {
        title: `Anuncio ${type} ${uniqueSlug('t')}`,
        slug: uniqueSlug('anuncio'),
        description: 'Descripción de prueba',
        price: 10,
        type,
        priceType: 'FIXED',
        ...(type === 'PRODUCT' ? { condition: 'GOOD' as const } : {}),
        categoryId,
        sellerId,
      },
    });
  }

  // ── Hacia arriba ─────────────────────────────────────────────────────────

  it('crear un hijo con política que contradice al padre → 400', async () => {
    const parent = await createCategory({
      name: 'ATP2 Padre A', slug: uniqueSlug('atp2-padre-a'), allowedListingType: 'SERVICE_ONLY',
    }).expect(201);

    await createCategory({
      name: 'ATP2 Hijo A', slug: uniqueSlug('atp2-hijo-a'), parentId: parent.body.id, allowedListingType: 'PRODUCT_ONLY',
    }).expect(400);
  });

  it('crear un hijo BOTH bajo un padre restringido → OK (BOTH no contradice)', async () => {
    const parent = await createCategory({
      name: 'ATP2 Padre B', slug: uniqueSlug('atp2-padre-b'), allowedListingType: 'SERVICE_ONLY',
    }).expect(201);

    await createCategory({
      name: 'ATP2 Hijo B', slug: uniqueSlug('atp2-hijo-b'), parentId: parent.body.id, allowedListingType: 'BOTH',
    }).expect(201);
  });

  it('crear un hijo con la MISMA restricción que el padre → OK', async () => {
    const parent = await createCategory({
      name: 'ATP2 Padre C', slug: uniqueSlug('atp2-padre-c'), allowedListingType: 'PRODUCT_ONLY',
    }).expect(201);

    await createCategory({
      name: 'ATP2 Hijo C', slug: uniqueSlug('atp2-hijo-c'), parentId: parent.body.id, allowedListingType: 'PRODUCT_ONLY',
    }).expect(201);
  });

  it('editar un hijo a una política que contradice al padre → 400', async () => {
    const parent = await createCategory({
      name: 'ATP2 Padre D', slug: uniqueSlug('atp2-padre-d'), allowedListingType: 'SERVICE_ONLY',
    }).expect(201);
    const child = await createCategory({
      name: 'ATP2 Hijo D', slug: uniqueSlug('atp2-hijo-d'), parentId: parent.body.id,
    }).expect(201); // BOTH por defecto

    await updateCategory(child.body.id, { allowedListingType: 'PRODUCT_ONLY' }).expect(400);
    await updateCategory(child.body.id, { allowedListingType: 'SERVICE_ONLY' }).expect(200);
  });

  // ── Hacia abajo (el núcleo) ──────────────────────────────────────────────

  it('cambiar el padre a PRODUCT_ONLY con un hijo SERVICE_ONLY → 400 con el nombre del hijo', async () => {
    const parent = await createCategory({ name: 'ATP2 Padre E', slug: uniqueSlug('atp2-padre-e') }).expect(201);
    await createCategory({
      name: 'ATP2 Hijo Restringido E', slug: uniqueSlug('atp2-hijo-e'), parentId: parent.body.id, allowedListingType: 'SERVICE_ONLY',
    }).expect(201);

    const res = await updateCategory(parent.body.id, { allowedListingType: 'PRODUCT_ONLY' }).expect(400);
    expect(res.body.message).toContain('ATP2 Hijo Restringido E');
  });

  it('cambiar el padre a PRODUCT_ONLY con anuncios SERVICE existentes en la propia categoría → 400 con el recuento', async () => {
    const parent = await createCategory({ name: 'ATP2 Padre F', slug: uniqueSlug('atp2-padre-f') }).expect(201);
    await createListingDirect(parent.body.id, 'SERVICE');
    await createListingDirect(parent.body.id, 'SERVICE');

    const res = await updateCategory(parent.body.id, { allowedListingType: 'PRODUCT_ONLY' }).expect(400);
    expect(res.body.message).toContain('2 anuncio(s)');
  });

  it('CRÍTICO: cambiar el padre a PRODUCT_ONLY con un hijo BOTH que tiene anuncios SERVICE → 400 (el count incluye a los hijos)', async () => {
    const parent = await createCategory({ name: 'ATP2 Padre G', slug: uniqueSlug('atp2-padre-g') }).expect(201);
    const child = await createCategory({
      name: 'ATP2 Hijo BOTH G', slug: uniqueSlug('atp2-hijo-g'), parentId: parent.body.id,
    }).expect(201); // BOTH por defecto — sin restricción propia
    await createListingDirect(child.body.id, 'SERVICE');

    const res = await updateCategory(parent.body.id, { allowedListingType: 'PRODUCT_ONLY' }).expect(400);
    expect(res.body.message).toContain('1 anuncio(s)');
  });

  it('ensanchar a BOTH siempre es OK, sin importar hijos/anuncios existentes', async () => {
    const parent = await createCategory({
      name: 'ATP2 Padre H', slug: uniqueSlug('atp2-padre-h'), allowedListingType: 'PRODUCT_ONLY',
    }).expect(201);
    await createCategory({
      name: 'ATP2 Hijo H', slug: uniqueSlug('atp2-hijo-h'), parentId: parent.body.id, allowedListingType: 'PRODUCT_ONLY',
    }).expect(201);
    await createListingDirect(parent.body.id, 'PRODUCT');

    await updateCategory(parent.body.id, { allowedListingType: 'BOTH' }).expect(200);
  });

  it('editar nombre/schema sin tocar allowedListingType nunca consulta la coherencia hacia abajo (no rompe aunque haya hijos/anuncios incompatibles con un cambio hipotético)', async () => {
    const parent = await createCategory({ name: 'ATP2 Padre I', slug: uniqueSlug('atp2-padre-i') }).expect(201);
    await createCategory({
      name: 'ATP2 Hijo I', slug: uniqueSlug('atp2-hijo-i'), parentId: parent.body.id, allowedListingType: 'SERVICE_ONLY',
    }).expect(201);
    await createListingDirect(parent.body.id, 'SERVICE');

    // Ni name ni attributeSchema tocan allowedListingType — debe ser 200 pese
    // a que un cambio de política aquí sería rechazado (test anterior).
    await updateCategory(parent.body.id, {
      name: 'ATP2 Padre I (renombrado)',
      attributeSchema: [{ name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false }],
    }).expect(200);
  });
});
