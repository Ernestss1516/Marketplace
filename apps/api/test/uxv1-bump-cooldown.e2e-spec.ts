/**
 * UXV.1 (A2) — la ventana de cooldown del bump tiene UNA sola fuente (e2e)
 *
 * El defecto: había TRES verdades sobre "¿puedo volver a bumpear?". El backend
 * rechazaba por debajo de 1 h, `MyListingCard` deshabilitaba el botón durante 24 h
 * (calculando `bumpedAt + 24h` en el cliente) y `ListingOwnerActions` no bloqueaba nada.
 * El botón de la tarjeta quedaba muerto 23 horas de más.
 *
 * El arreglo: la ventana vive en `bump-cooldown.ts` (backend), se aplica en
 * `BillingService.bump` y se sirve YA RESUELTA como `nextBumpAt` en los DOS payloads
 * que alimentan las dos superficies de propietario:
 *   - `GET /listings/mine`  → la tarjeta de /mis-anuncios
 *   - `GET /listings/:slug` → la ficha pública (ListingOwnerActions)
 *
 * Lo que esta suite fija, y que es justo lo que estaba roto:
 *   1. `nextBumpAt` = último bump + la ventana REAL (1 h, no 24 h).
 *   2. Las dos superficies devuelven EXACTAMENTE el mismo instante para el mismo anuncio.
 *   3. `nextBumpAt` y el guard del backend no pueden discrepar: si el campo dice
 *      "disponible", el POST pasa; si dice "espera", el POST da 429.
 *   4. Un bump invalida la ficha cacheada, así que la ficha no puede quedarse 5 min
 *      diciendo lo contrario que la tarjeta.
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { BUMP_COOLDOWN_SECONDS } from 'src/modules/billing/bump-cooldown';

const COOLDOWN_MS = BUMP_COOLDOWN_SECONDS * 1000;

async function loginUser(
  app: INestApplication,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  return res.body.accessToken as string;
}

describe('UXV.1 (A2) — cooldown del bump: una fuente, dos superficies (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let sellerUserId: string;
  let sellerToken: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const seller = await prisma.user.create({
      data: {
        email: 'uxv1-seller@example.com',
        name: 'UXV1 Seller',
        slug: 'uxv1-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    sellerUserId = seller.id;
    sellerToken = await loginUser(app, 'uxv1-seller@example.com', 'Test1234!');

    // Saldo de sobra: aquí no se prueba el cobro, solo la ventana.
    await prisma.wallet.create({ data: { userId: sellerUserId, balance: 500 } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** Anuncio ACTIVE del vendedor, opcionalmente con un último bump ya fijado. */
  async function createActiveListing(
    suffix: string,
    bumpedAt: Date | null = null,
  ): Promise<{ id: string; slug: string }> {
    const listing = await prisma.listing.create({
      data: {
        title: `UXV1 listing ${suffix}`,
        slug: `uxv1-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: 'E2e listing para el contrato de cooldown',
        price: new Prisma.Decimal('100.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        sellerId: sellerUserId,
        categoryId,
        publishedAt: new Date(),
        ...(bumpedAt && { bumpedAt }),
      },
    });
    return { id: listing.id, slug: listing.slug };
  }

  /** `nextBumpAt` tal y como lo ve la TARJETA (/mis-anuncios → GET /users/me/listings). */
  async function nextBumpAtFromMine(listingId: string): Promise<string | null> {
    const res = await request(app.getHttpServer())
      .get('/api/users/me/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    const item = res.body.items.find((i: { id: string }) => i.id === listingId);
    expect(item).toBeDefined();
    return item.nextBumpAt ?? null;
  }

  /** `nextBumpAt` tal y como lo ve la FICHA pública (ListingOwnerActions). */
  async function nextBumpAtFromFicha(slug: string): Promise<string | null> {
    const res = await request(app.getHttpServer()).get(`/api/listings/${slug}`).expect(200);
    return res.body.nextBumpAt ?? null;
  }

  // -------------------------------------------------------------------------
  // 1. La ventana es la real (1 h), no la que se inventaba el frontend (24 h)
  // -------------------------------------------------------------------------

  it('nextBumpAt = último bump + la ventana del backend (y NO las 24 h que asumía la tarjeta)', async () => {
    const bumpedAt = new Date();
    const { id } = await createActiveListing('ventana', bumpedAt);

    const nextBumpAt = await nextBumpAtFromMine(id);
    expect(nextBumpAt).not.toBeNull();

    const delta = new Date(nextBumpAt!).getTime() - bumpedAt.getTime();
    expect(delta).toBe(COOLDOWN_MS);
    // El bug concreto: 24 h. Si alguien vuelve a meter esa constante, esto lo caza.
    expect(delta).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('nextBumpAt es null en un anuncio que nunca se ha bumpeado', async () => {
    const { id, slug } = await createActiveListing('nunca');

    expect(await nextBumpAtFromMine(id)).toBeNull();
    expect(await nextBumpAtFromFicha(slug)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 2. Las dos superficies coinciden
  // -------------------------------------------------------------------------

  it('la tarjeta y la ficha devuelven el MISMO nextBumpAt para el mismo anuncio', async () => {
    const bumpedAt = new Date(Date.now() - 10 * 60_000); // hace 10 min → en cooldown
    const { id, slug } = await createActiveListing('coinciden', bumpedAt);

    const fromMine = await nextBumpAtFromMine(id);
    const fromFicha = await nextBumpAtFromFicha(slug);

    expect(fromMine).not.toBeNull();
    expect(fromFicha).toBe(fromMine);
  });

  // -------------------------------------------------------------------------
  // 3. El campo y el guard no pueden discrepar
  // -------------------------------------------------------------------------

  it('si nextBumpAt está en el futuro, el POST da 429 (las dos superficies bloquean con razón)', async () => {
    const { id, slug } = await createActiveListing('en-cooldown', new Date());

    const nextBumpAt = await nextBumpAtFromMine(id);
    expect(new Date(nextBumpAt!).getTime()).toBeGreaterThan(Date.now());
    expect(await nextBumpAtFromFicha(slug)).toBe(nextBumpAt);

    const res = await request(app.getHttpServer())
      .post(`/api/listings/${id}/bump`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(429);
    expect(res.body.retryAfter).toBeDefined();
  });

  it('pasada la ventana el bump se acepta — el botón llevaba 23 h deshabilitado sin motivo', async () => {
    // Un minuto MÁS que la ventana: con la regla vieja de 24 h esto seguía bloqueado.
    const bumpedAt = new Date(Date.now() - (COOLDOWN_MS + 60_000));
    const { id, slug } = await createActiveListing('pasada-ventana', bumpedAt);

    const nextBumpAt = await nextBumpAtFromMine(id);
    expect(new Date(nextBumpAt!).getTime()).toBeLessThan(Date.now());
    expect(await nextBumpAtFromFicha(slug)).toBe(nextBumpAt);

    await request(app.getHttpServer())
      .post(`/api/listings/${id}/bump`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
  });

  // -------------------------------------------------------------------------
  // 4. Un bump no deja la ficha mintiendo durante los 5 min de caché
  // -------------------------------------------------------------------------

  it('tras bumpear, la ficha refleja el nuevo cooldown de inmediato (caché invalidada)', async () => {
    const bumpedAt = new Date(Date.now() - (COOLDOWN_MS + 60_000));
    const { id, slug } = await createActiveListing('invalida-cache', bumpedAt);

    // Primera lectura: puebla la caché de la ficha con el bumpedAt viejo.
    const before = await nextBumpAtFromFicha(slug);
    expect(new Date(before!).getTime()).toBeLessThan(Date.now());

    await request(app.getHttpServer())
      .post(`/api/listings/${id}/bump`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    // Sin invalidación, esto seguiría devolviendo `before` hasta 5 minutos.
    const after = await nextBumpAtFromFicha(slug);
    expect(after).not.toBe(before);
    expect(new Date(after!).getTime()).toBeGreaterThan(Date.now());

    // Y la tarjeta dice exactamente lo mismo.
    expect(await nextBumpAtFromMine(id)).toBe(after);
  });
});
