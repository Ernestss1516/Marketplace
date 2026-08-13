/**
 * PUERTA DE VALIDACIÓN — LA PRUEBA ESTRUCTURAL DE COBERTURA.
 *
 * ESTE ES EL TEST MÁS IMPORTANTE DE LA PUERTA, y no prueba ninguna regla.
 * Prueba que TODOS los caminos que llevan un anuncio a ACTIVE pasan por ella.
 *
 * POR QUÉ HACE FALTA UNA BARRERA Y NO BASTA LA DISCIPLINA. Este repo ya tiene la
 * cicatriz: `ListingActivationService.listingBecameActive` lleva escrito en su
 * cabecera «Called by every path that transitions a Listing to ACTIVE», y la
 * auditoría comprobó que era FALSO en tres caminos. Una convención documentada no
 * impide que el cuarto camino se olvide; un test que falla, sí.
 *
 * CÓMO FUNCIONA. Se sustituye la lista de reglas de la puerta por UNA regla que
 * siempre falla, y se ejerce cada camino. Si un camino llama a la puerta, es
 * rechazado. Si NO la llama, la transición ocurre y el anuncio acaba ACTIVE — y
 * eso es lo que este test caza.
 *
 * SI ALGUIEN AÑADE UN CAMINO NUEVO a ACTIVE y no lo mete aquí, este test no lo
 * detecta: el listado es manual. Lo que sí garantiza es que ninguno de los que
 * HOY están cubiertos deje de estarlo en silencio. La enumeración se hizo por
 * `listing.update*` y no por un grep de `'status: ACTIVE'`, que pierde los tres
 * caminos que escriben el estado por variable (`targetStatus`, `newStatus`,
 * `dto.status`).
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from 'src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { cleanDb } from './helpers/db';
import {
  LISTING_GATE_RULES,
  type GateReason,
  type ListingGateRule,
} from 'src/modules/listing-gate/listing-gate.types';

/** La regla que siempre falla. Es el instrumento de medida de este test. */
const REGLA_QUE_SIEMPRE_FALLA: ListingGateRule = {
  name: 'siempre-falla',
  group: 'entrada',
  appliesTo: () => true,
  check: async (): Promise<GateReason> => ({
    code: 'PRUEBA_DE_COBERTURA',
    message: 'Bloqueado por la prueba de cobertura de la puerta',
  }),
};

describe('Puerta — cobertura estructural de los caminos a ACTIVE (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;
  let sellerId: string;
  let sellerToken: string;
  let buyerId: string;
  let adminToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();

    // La app se construye A MANO (no con el helper) para poder SUSTITUIR la lista
    // de reglas. Es justo lo que hace útil que la lista sea un provider inyectado
    // y no un array escrito dentro del servicio.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LISTING_GATE_RULES)
      .useValue([REGLA_QUE_SIEMPRE_FALLA])
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.setGlobalPrefix('api');
    await app.init();

    await cleanDb(prisma);
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = cat.id;

    const passwordHash = await bcrypt.hash('Test1234!', 4);
    const seller = await prisma.user.create({
      data: { email: 'gate-seller@example.com', name: 'Gate Seller', slug: 'gate-seller', passwordHash, emailVerified: true },
    });
    sellerId = seller.id;
    const buyer = await prisma.user.create({
      data: { email: 'gate-buyer@example.com', name: 'Gate Buyer', slug: 'gate-buyer', passwordHash, emailVerified: true },
    });
    buyerId = buyer.id;
    await prisma.user.create({
      data: { email: 'gate-admin@example.com', name: 'Gate Admin', slug: 'gate-admin', passwordHash, emailVerified: true, role: 'ADMIN' },
    });

    const [s, a] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'gate-seller@example.com', password: 'Test1234!' }),
      request(app.getHttpServer()).post('/api/auth/admin-login').send({ email: 'gate-admin@example.com', password: 'Test1234!' }),
    ]);
    sellerToken = s.body.accessToken as string;
    adminToken = a.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let n = 0;
  async function seedListing(
    status: ListingStatus,
    opts: { type?: 'PRODUCT' | 'SERVICE' } = {},
  ): Promise<{ id: string; slug: string }> {
    n += 1;
    return prisma.listing.create({
      data: {
        title: `Puerta cobertura ${n}`,
        slug: `puerta-cobertura-${n}-${Date.now()}`,
        description: 'Anuncio de la prueba de cobertura de la puerta',
        price: new Prisma.Decimal('10.00'),
        type: opts.type ?? 'PRODUCT',
        priceType: 'FIXED',
        condition: opts.type === 'SERVICE' ? null : 'GOOD',
        status,
        sellerId,
        categoryId,
        ...(status === ListingStatus.ACTIVE || status === ListingStatus.EXPIRED
          ? { publishedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 86_400_000) }
          : {}),
      },
      select: { id: true, slug: true },
    });
  }

  /** Comprueba que el anuncio NO acabó activo — la garantía de fondo. */
  async function siguesinActivar(id: string): Promise<ListingStatus> {
    const l = await prisma.listing.findUniqueOrThrow({ where: { id }, select: { status: true } });
    return l.status;
  }

  // ===========================================================================
  // Caminos de VENDEDOR
  // ===========================================================================

  it('publish — la puerta lo frena', async () => {
    const l = await seedListing(ListingStatus.DRAFT);
    const res = await request(app.getHttpServer())
      .post(`/api/listings/${l.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await siguesinActivar(l.id)).toBe(ListingStatus.DRAFT);
  });

  it('renew — la puerta lo frena', async () => {
    const l = await seedListing(ListingStatus.EXPIRED);
    const res = await request(app.getHttpServer())
      .post(`/api/listings/${l.id}/renew`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await siguesinActivar(l.id)).toBe(ListingStatus.EXPIRED);
  });

  it('reactivate — la puerta lo frena', async () => {
    const l = await seedListing(ListingStatus.PAUSED);
    const res = await request(app.getHttpServer())
      .post(`/api/listings/${l.id}/reactivate`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await siguesinActivar(l.id)).toBe(ListingStatus.PAUSED);
  });

  it('undoDeal (SOLD → ACTIVE) — la puerta lo frena', async () => {
    // Se prepara con Prisma: cerrar el trato por la API pasaría por la puerta.
    const l = await seedListing(ListingStatus.SOLD);
    const deal = await prisma.deal.create({
      data: { listingId: l.id, listingTitle: 'x', sellerId, buyerId },
      select: { id: true },
    });

    const res = await request(app.getHttpServer())
      .delete(`/api/listings/${l.id}/deals/${deal.id}`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await siguesinActivar(l.id)).toBe(ListingStatus.SOLD);
  });

  // ===========================================================================
  // Caminos de STAFF
  //
  // Pasan por la puerta IGUAL que los de vendedor. Que la cuota no les aplique es
  // cosa del `appliesTo` de esa regla, no de saltarse la puerta — y esta prueba
  // fija la diferencia: con una regla que aplica a todos, staff también se frena.
  // ===========================================================================

  it('approveListing (staff) — la puerta lo frena', async () => {
    const l = await seedListing(ListingStatus.PENDING_REVIEW);
    const res = await request(app.getHttpServer())
      .post(`/api/moderation/listings/${l.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await siguesinActivar(l.id)).toBe(ListingStatus.PENDING_REVIEW);
  });

  it('restoreListing (staff) — la puerta lo frena', async () => {
    const l = await seedListing(ListingStatus.REJECTED);
    const res = await request(app.getHttpServer())
      .post(`/api/moderation/listings/${l.id}/restore`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await siguesinActivar(l.id)).toBe(ListingStatus.REJECTED);
  });

  it('changeListingStatus → ACTIVE (staff) — la puerta lo frena', async () => {
    const l = await seedListing(ListingStatus.PENDING_REVIEW);
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/listings/${l.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await siguesinActivar(l.id)).toBe(ListingStatus.PENDING_REVIEW);
  });

  // ===========================================================================
  // Lo que la puerta NO debe frenar
  // ===========================================================================

  it('las transiciones que SACAN de ACTIVE no pasan por la puerta', async () => {
    // Pausar, reservar o archivar liberan plaza: validarlos sería absurdo, y
    // frenarlos dejaría a un vendedor sin poder retirar su propio anuncio.
    const l = await seedListing(ListingStatus.ACTIVE);
    await request(app.getHttpServer())
      .post(`/api/listings/${l.id}/pause`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(await siguesinActivar(l.id)).toBe(ListingStatus.PAUSED);
  });

  it('changeListingStatus a un destino que NO es ACTIVE no pasa por la puerta', async () => {
    const l = await seedListing(ListingStatus.ACTIVE);
    await request(app.getHttpServer())
      .patch(`/api/admin/listings/${l.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED' })
      .expect(200);
    expect(await siguesinActivar(l.id)).toBe(ListingStatus.REJECTED);
  });

  // ===========================================================================
  // El contrato de fallo
  // ===========================================================================

  it('el rechazo trae `reasons` ADEMÁS de `message` y `code`', async () => {
    const l = await seedListing(ListingStatus.DRAFT);
    const res = await request(app.getHttpServer())
      .post(`/api/listings/${l.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`);

    // `message` y `code` siguen siendo lo que un cliente antiguo lee.
    expect(typeof res.body.message).toBe('string');
    expect(res.body.code).toBe('PRUEBA_DE_COBERTURA');
    // `reasons` es lo nuevo, y es aditivo.
    expect(res.body.reasons).toEqual([
      { code: 'PRUEBA_DE_COBERTURA', message: 'Bloqueado por la prueba de cobertura de la puerta' },
    ]);
  });
});
