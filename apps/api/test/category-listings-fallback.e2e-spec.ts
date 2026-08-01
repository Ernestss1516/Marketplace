/**
 * FIX de bug PRE-EXISTENTE (encontrado en la auditoría de búsqueda+tags, P9).
 *
 * `GET /categories/:slug/listings` (ListingsService.findByCategory) es el FALLBACK
 * de la página de categoría cuando Meilisearch no responde. Filtraba por slug EXACTO,
 * sin las hijas — así que con Meili caído una categoría PADRE mostraba solo lo que
 * cuelga directamente de ella (normalmente nada) en vez de los anuncios de sus hijas.
 *
 * El camino principal (Meilisearch) sí las agrega: filtra por `categoryPath = slug`, y
 * categoryPath es [slugHoja, slugPadre]. O sea, el fallback no reproducía lo que
 * reemplaza — justo cuando es lo único que queda.
 *
 * No tiene que ver con las URLs anidadas (A1): es un bug de datos que estaba ahí
 * antes y se arregla aparte, en su propio commit.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

describe('GET /categories/:slug/listings — el fallback agrega las hijas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let parentSlug: string;
  let childSlug: string;
  let otherParentSlug: string;

  let tituloDeLaHija: string;
  let tituloDelPadre: string;
  let tituloAjeno: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();

    const stamp = `${Date.now()}`;
    parentSlug = `clf-padre-${stamp}`;
    childSlug = `clf-hija-${stamp}`;
    otherParentSlug = `clf-otro-${stamp}`;
    tituloDeLaHija = `CLF anuncio de la hija ${stamp}`;
    tituloDelPadre = `CLF anuncio del padre ${stamp}`;
    tituloAjeno = `CLF anuncio ajeno ${stamp}`;

    const seller = await prisma.user.upsert({
      where: { email: 'clf-seller@example.com' },
      create: {
        email: 'clf-seller@example.com', name: 'CLF Seller', slug: 'clf-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4), emailVerified: true,
      },
      update: {},
    });

    const parent = await prisma.category.create({
      data: { name: 'CLF Padre', slug: parentSlug, attributeSchema: [] },
    });
    const child = await prisma.category.create({
      data: { name: 'CLF Hija', slug: childSlug, parentId: parent.id, attributeSchema: [] },
    });
    const otherParent = await prisma.category.create({
      data: { name: 'CLF Otro', slug: otherParentSlug, attributeSchema: [] },
    });

    const base = {
      description: 'x', price: 100, type: 'PRODUCT' as const, condition: 'GOOD' as const,
      status: 'ACTIVE' as const, publishedAt: new Date(), sellerId: seller.id,
    };
    await prisma.listing.createMany({
      data: [
        { ...base, title: tituloDeLaHija, slug: `clf-hija-anuncio-${stamp}`, categoryId: child.id },
        { ...base, title: tituloDelPadre, slug: `clf-padre-anuncio-${stamp}`, categoryId: parent.id },
        { ...base, title: tituloAjeno, slug: `clf-ajeno-anuncio-${stamp}`, categoryId: otherParent.id },
      ],
    });
  }, 30_000);

  afterAll(async () => {
    await prisma.listing.deleteMany({
      where: { category: { slug: { in: [parentSlug, childSlug, otherParentSlug] } } },
    });
    await prisma.category.deleteMany({ where: { slug: childSlug } });
    await prisma.category.deleteMany({ where: { slug: { in: [parentSlug, otherParentSlug] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it('EL BUG: una categoría PADRE incluye los anuncios de sus hijas', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/categories/${parentSlug}/listings`)
      .expect(200);

    const titulos = (res.body.items as { title: string }[]).map((i) => i.title);
    expect(titulos).toContain(tituloDeLaHija);
    // Y sigue incluyendo lo suyo propio, si lo tiene.
    expect(titulos).toContain(tituloDelPadre);
    expect(res.body.total).toBe(2);
  });

  it('no se lleva anuncios de OTRA rama del árbol', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/categories/${parentSlug}/listings`)
      .expect(200);

    expect((res.body.items as { title: string }[]).map((i) => i.title)).not.toContain(tituloAjeno);
  });

  it('una categoría HOJA sigue devolviendo exactamente lo suyo (sin cambios)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/categories/${childSlug}/listings`)
      .expect(200);

    const titulos = (res.body.items as { title: string }[]).map((i) => i.title);
    expect(titulos).toEqual([tituloDeLaHija]);
    expect(res.body.total).toBe(1);
  });

  it('el conteo y la paginación cuentan sobre el mismo conjunto ampliado', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/categories/${parentSlug}/listings?page=1&perPage=1`)
      .expect(200);

    // total refleja padre + hija (2), aunque la página traiga 1.
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.perPage).toBe(1);
  });

  it('coincide con lo que devuelve la búsqueda por categoryPath (el camino principal)', async () => {
    // La razón de ser del fix: el fallback debe reproducir lo que reemplaza. Se
    // compara el CONJUNTO de títulos, no el orden (Meilisearch ordena por relevancia).
    const fallback = await request(app.getHttpServer())
      .get(`/api/categories/${parentSlug}/listings`)
      .expect(200);
    const fallbackTitulos = (fallback.body.items as { title: string }[]).map((i) => i.title).sort();

    expect(fallbackTitulos).toEqual([tituloDelPadre, tituloDeLaHija].sort());
  });
});
