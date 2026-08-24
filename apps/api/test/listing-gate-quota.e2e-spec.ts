/**
 * PUERTA — RÁFAGA 1. LA CUOTA DE ACTIVOS, CENTRALIZADA.
 *
 * `listing-gate-coverage` prueba la ESTRUCTURA —que todos los caminos a ACTIVE
 * pasan por la puerta— con una regla de mentira. Esta suite prueba la REGLA DE
 * VERDAD, y en concreto las dos consecuencias de haberla movido:
 *
 *  1. LAS FUGAS CERRADAS. La cuota vivía en un método `private` de
 *     `ListingsService`: `reactivate` y `undoDeal` la comprobaban porque la
 *     ráfaga (A) fue a taparlos a mano, uno por uno. Ahora la heredan por pasar
 *     por la puerta, y estos tests fijan que siguen frenados si alguien deshace
 *     el cableado.
 *
 *  2. STAFF EXENTO. Antes era una ausencia de facto —moderación no tenía forma
 *     de llamar a un método privado de otro servicio—. Ahora es una línea
 *     declarativa (`appliesTo`), y por tanto algo que se puede romper por
 *     descuido. Estos tests la fijan.
 *
 * CADA BLOQUEO VA CON SU CONTROL POSITIVO (mismo camino, con hueco en el cupo).
 * Sin él, un camino que fallara SIEMPRE —por la razón que fuese— pasaría estos
 * tests dando la impresión de que la cuota funciona.
 *
 * `publish`/`renew` no se prueban aquí: los cubre `rf7-limits`, que no se ha
 * tocado, y que sigue verde es justo la prueba de que su comportamiento no ha
 * cambiado. La única excepción es el mensaje literal, que se ancla abajo.
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

/** El tope free por defecto, sin fila de Setting. El de siempre. */
const FREE_LIMIT = 5;

describe('Puerta — la cuota de activos, centralizada (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;
  let sellerId: string;
  let sellerToken: string;
  let buyerId: string;
  let adminToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = cat.id;

    const passwordHash = await bcrypt.hash('Test1234!', 4);
    const seller = await prisma.user.create({
      data: { email: 'cuota-seller@example.com', name: 'Cuota Seller', slug: 'cuota-seller', passwordHash, emailVerified: true },
    });
    sellerId = seller.id;
    const buyer = await prisma.user.create({
      data: { email: 'cuota-buyer@example.com', name: 'Cuota Buyer', slug: 'cuota-buyer', passwordHash, emailVerified: true },
    });
    buyerId = buyer.id;
    await prisma.user.create({
      data: { email: 'cuota-admin@example.com', name: 'Cuota Admin', slug: 'cuota-admin', passwordHash, emailVerified: true, role: 'ADMIN' },
    });

    const [s, a] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'cuota-seller@example.com', password: 'Test1234!' }),
      request(app.getHttpServer()).post('/api/auth/admin-login').send({ email: 'cuota-admin@example.com', password: 'Test1234!' }),
    ]);
    sellerToken = s.body.accessToken as string;
    adminToken = a.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let n = 0;
  async function seedListing(status: ListingStatus): Promise<{ id: string }> {
    n += 1;
    return prisma.listing.create({
      data: {
        title: `Cuota puerta ${n}`,
        slug: `cuota-puerta-${n}-${Date.now()}`,
        description: 'Anuncio de la suite de cuota de la puerta',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status,
        sellerId,
        categoryId,
        ...(status === ListingStatus.ACTIVE || status === ListingStatus.EXPIRED
          ? { publishedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 86_400_000) }
          : {}),
      },
      select: { id: true },
    });
  }

  /**
   * Deja al vendedor con EXACTAMENTE `FREE_LIMIT` activos: el conteo de la regla
   * es `>= limit`, así que a partir de aquí cualquier plaza nueva se rechaza.
   */
  async function llenarCupo(): Promise<void> {
    await vaciarCupo();
    for (let i = 0; i < FREE_LIMIT; i++) await seedListing(ListingStatus.ACTIVE);
  }

  /** Deja el cupo a cero, para el control positivo. */
  async function vaciarCupo(): Promise<void> {
    await prisma.listing.deleteMany({ where: { sellerId, status: ListingStatus.ACTIVE } });
  }

  async function estado(id: string): Promise<ListingStatus> {
    const l = await prisma.listing.findUniqueOrThrow({ where: { id }, select: { status: true } });
    return l.status;
  }

  async function crearTrato(listingId: string): Promise<string> {
    const deal = await prisma.deal.create({
      data: { listingId, listingTitle: 'x', sellerId, buyerId },
      select: { id: true },
    });
    return deal.id;
  }

  // ===========================================================================
  // FUGAS CERRADAS — caminos de vendedor a los que la cuota no llegaba
  // ===========================================================================

  describe('reactivate (PAUSED → ACTIVE)', () => {
    it('con el cupo lleno → 403, y el anuncio sigue PAUSED', async () => {
      const l = await seedListing(ListingStatus.PAUSED);
      await llenarCupo();

      const res = await request(app.getHttpServer())
        .post(`/api/listings/${l.id}/reactivate`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(403);
      expect(res.body.code).toBe('ACTIVE_LIMIT_REACHED');
      expect(await estado(l.id)).toBe(ListingStatus.PAUSED);
    });

    it('con hueco en el cupo → 200 (control positivo: no falla por otra cosa)', async () => {
      const l = await seedListing(ListingStatus.PAUSED);
      await vaciarCupo();

      await request(app.getHttpServer())
        .post(`/api/listings/${l.id}/reactivate`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      expect(await estado(l.id)).toBe(ListingStatus.ACTIVE);
    });
  });

  describe('undoDeal (SOLD → ACTIVE)', () => {
    it('con el cupo lleno → 403: ni resucita el anuncio ni borra el trato', async () => {
      const l = await seedListing(ListingStatus.SOLD);
      const dealId = await crearTrato(l.id);
      await llenarCupo();

      const res = await request(app.getHttpServer())
        .delete(`/api/listings/${l.id}/deals/${dealId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(403);
      expect(res.body.code).toBe('ACTIVE_LIMIT_REACHED');
      expect(await estado(l.id)).toBe(ListingStatus.SOLD);
      // La puerta se consulta ANTES de abrir la transacción: el trato tiene que
      // seguir intacto, no borrado y luego revertido a medias.
      expect(await prisma.deal.findUnique({ where: { id: dealId } })).not.toBeNull();
    });

    it('con hueco en el cupo → 200, vuelve a ACTIVE (control positivo)', async () => {
      const l = await seedListing(ListingStatus.SOLD);
      const dealId = await crearTrato(l.id);
      await vaciarCupo();

      await request(app.getHttpServer())
        .delete(`/api/listings/${l.id}/deals/${dealId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      expect(await estado(l.id)).toBe(ListingStatus.ACTIVE);
    });
  });

  // ===========================================================================
  // STAFF EXENTO — decisión formalizada (docs/diseno-puerta-validacion.md, D3)
  //
  // El vendedor está en el tope en los tres casos. Si alguno diera 403, el
  // trabajo de moderación quedaría rehén de la cuota de un tercero.
  // ===========================================================================

  describe('Staff está exento de la cuota', () => {
    it('approveListing con el cupo del vendedor lleno → aprueba igual', async () => {
      const l = await seedListing(ListingStatus.PENDING_REVIEW);
      await llenarCupo();

      await request(app.getHttpServer())
        .post(`/api/moderation/listings/${l.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(await estado(l.id)).toBe(ListingStatus.ACTIVE);
    });

    it('restoreListing con el cupo del vendedor lleno → restaura igual', async () => {
      const l = await seedListing(ListingStatus.REJECTED);
      await llenarCupo();

      await request(app.getHttpServer())
        .post(`/api/moderation/listings/${l.id}/restore`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(await estado(l.id)).toBe(ListingStatus.ACTIVE);
    });

    it('changeListingStatus → ACTIVE con el cupo del vendedor lleno → cambia igual', async () => {
      const l = await seedListing(ListingStatus.PENDING_REVIEW);
      await llenarCupo();

      await request(app.getHttpServer())
        .patch(`/api/admin/listings/${l.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'ACTIVE' })
        .expect(200);
      expect(await estado(l.id)).toBe(ListingStatus.ACTIVE);
    });
  });

  // ===========================================================================
  // EL CONTRATO DE FALLO — aditivo, no sustitutivo
  // ===========================================================================

  it('el 403 de la cuota mantiene `message` y `code` literales, y añade `reasons`', async () => {
    const l = await seedListing(ListingStatus.DRAFT);
    await llenarCupo();

    const res = await request(app.getHttpServer())
      .post(`/api/listings/${l.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(403);

    // El texto era VERBATIM el del `checkActiveListingLimit` que se borró, y esa era la
    // afirmación correcta MIENTRAS lo único que se hacía era mudar la regla de sitio.
    //
    // E-3 lo cambia A PROPÓSITO: el mensaje se quedaba en «de tu plan» —insinuando que hay
    // otro plan sin decir cuál ni cuánto da— justo en el momento en que un vendedor
    // gratuito descubre que le hace falta más sitio. Ahora ofrece la salida.
    //
    // Lo que este caso sigue fijando es lo que NO cambió: la primera frase es la de
    // siempre, el `code` es el de siempre, y `reasons` sigue siendo aditivo.
    expect(res.body.message).toContain(
      `Has alcanzado el límite de ${FREE_LIMIT} anuncios activos de tu plan`,
    );
    expect(res.body.message).toMatch(/con pro puedes tener hasta \d+/i);
    expect(res.body.code).toBe('ACTIVE_LIMIT_REACHED');

    // `reasons` es puro añadido. Con un solo motivo, su mensaje ES el `message`
    // de arriba: la respuesta resulta indistinguible de la anterior salvo por
    // este campo de más.
    expect(res.body.reasons).toEqual([
      { code: 'ACTIVE_LIMIT_REACHED', message: res.body.message },
    ]);
  });
});
