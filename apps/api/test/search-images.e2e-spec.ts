/**
 * BÚSQUEDA — RÁFAGA 2 (fotos en las cards): `ListingDocument.images` — el
 * array ORDENADO de URLs de TODAS las fotos del anuncio, no solo la primera
 * (`thumbnailUrl`). Necesario para el carrusel dentro de la card sin pegar a
 * Postgres por selección. Listings + ListingImage creados directamente en
 * Prisma (sin pasar por el flujo de subida) e indexados vía SearchService,
 * mismo patrón que rf8-meilisearch.e2e-spec.ts.
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { SearchService, INDEX_INCLUDE } from 'src/modules/search/search.service';

describe('Search — images en ListingDocument (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let searchService: SearchService;
  let userId: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();
    searchService = app.get(SearchService);

    await cleanDb(prisma);
    await resetMeili(meili);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const user = await prisma.user.create({
      data: {
        email: 'search-images-seller@example.com',
        name: 'Search Images Seller',
        slug: 'search-images-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    userId = user.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('images incluye TODAS las fotos, ordenadas por `order`, no solo la primera', async () => {
    const listing = await prisma.listing.create({
      data: {
        title: 'CarruselMultifotoRafaga2',
        slug: `search-images-${Date.now()}`,
        description: 'Anuncio con varias fotos',
        price: new Prisma.Decimal('100.00'),
        currency: 'EUR',
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        categoryId,
        sellerId: userId,
        publishedAt: new Date(),
      },
    });

    // Insertadas fuera de orden a propósito — el documento debe respetar `order`, no el orden de inserción.
    await prisma.listingImage.createMany({
      data: [
        { listingId: listing.id, url: 'https://example.com/photo-2.jpg', order: 2 },
        { listingId: listing.id, url: 'https://example.com/photo-0.jpg', order: 0 },
        { listingId: listing.id, url: 'https://example.com/photo-1.jpg', order: 1 },
      ],
    });

    const withRelations = await prisma.listing.findUniqueOrThrow({
      where: { id: listing.id },
      include: INDEX_INCLUDE,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await searchService.indexListing(withRelations as any);

    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ q: 'CarruselMultifotoRafaga2' })
      .expect(200);

    expect(res.body.hits).toHaveLength(1);
    const hit = res.body.hits[0] as { images: string[]; thumbnailUrl: string };
    expect(hit.images).toEqual([
      'https://example.com/photo-0.jpg',
      'https://example.com/photo-1.jpg',
      'https://example.com/photo-2.jpg',
    ]);
    // thumbnailUrl sigue siendo la primera — sin cambios de comportamiento para quien ya lo usa.
    expect(hit.thumbnailUrl).toBe('https://example.com/photo-0.jpg');
  });

  it('anuncio sin fotos → images: [] (no rompe, no queda undefined)', async () => {
    const listing = await prisma.listing.create({
      data: {
        title: 'AnuncioCeroImagenesRafaga2',
        slug: `search-images-nofotos-${Date.now()}`,
        description: 'Anuncio sin fotos',
        price: new Prisma.Decimal('50.00'),
        currency: 'EUR',
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        categoryId,
        sellerId: userId,
        publishedAt: new Date(),
      },
    });

    const withRelations = await prisma.listing.findUniqueOrThrow({
      where: { id: listing.id },
      include: INDEX_INCLUDE,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await searchService.indexListing(withRelations as any);

    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ q: 'AnuncioCeroImagenesRafaga2' })
      .expect(200);

    expect(res.body.hits).toHaveLength(1);
    expect(res.body.hits[0].images).toEqual([]);
  });
});
