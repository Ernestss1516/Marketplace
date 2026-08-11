/**
 * RÁFAGA (A) — EL BUG ACTIVO del ciclo de vida del anuncio, e2e.
 *
 * Dos cosas, deliberadamente separadas porque responden a preguntas distintas
 * (ver docs/auditoria-puerta-validacion.md, Bloque 3):
 *
 *   A1 — LA MÁQUINA DE ESTADOS (topología): «¿es legal ir de X a Y?».
 *        `AdminService.changeListingStatus` era el único escritor de estado sin
 *        guarda: su DTO solo declara `@IsEnum(ListingStatus)`, así que cualquier
 *        estado valía desde cualquier estado — incluido resucitar un `ARCHIVED`,
 *        que schema.prisma declara «permanente, IRREVERSIBLE».
 *
 *   A2 — LA CUOTA de anuncios activos: qué caminos llegan a ACTIVE sin mirarla.
 *
 * NO se prueba aquí la validez del anuncio (categoría, atributos, correo, fotos):
 * eso es la futura puerta de validación, un proyecto posterior. Esta ráfaga es
 * solo topología + recuento.
 *
 * Corre por HTTP y contra la BD real: la máquina de estados es una transición de
 * FILA (guard → UPDATE → AuditLog), y con Prisma mockeado se estaría probando el
 * `if` y no la transición — mismo criterio que tickets-state-machine.e2e-spec.ts.
 *
 * ALGUNOS CASOS SON *PINNED*, no aspiracionales: fijan un comportamiento que se
 * decidió MANTENER (staff exento de cuota; closeDeal sin cuota) para que quien
 * lo cambie lo vea romperse a propósito y no por accidente. Están marcados.
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

/**
 * Los ADMIN entran por `/auth/admin-login`; `/auth/login` los rechaza a
 * propósito (`ADMIN_MUST_USE_ADMIN_LOGIN`). Mismo reparto que admin.e2e-spec.ts.
 */
async function login(
  app: INestApplication,
  email: string,
  ruta: 'login' | 'admin-login' = 'login',
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`/api/auth/${ruta}`)
    .send({ email, password: 'Test1234!' });
  return res.body.accessToken as string;
}

describe('RÁFAGA (A) — máquina de estados + cuota en los caminos a ACTIVE (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;
  let adminToken: string;
  let sellerId: string;
  let sellerToken: string;
  let buyerId: string;

  /** El límite free por defecto que aplica `checkActiveListingLimit` sin fila de Setting. */
  const FREE_LIMIT = 5;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = cat.id;

    const passwordHash = await bcrypt.hash('Test1234!', 4);

    await prisma.user.create({
      data: {
        email: 'a-admin@example.com',
        name: 'A Admin',
        slug: 'a-admin',
        passwordHash,
        emailVerified: true,
        role: 'ADMIN',
      },
    });
    adminToken = await login(app, 'a-admin@example.com', 'admin-login');

    const seller = await prisma.user.create({
      data: {
        email: 'a-seller@example.com',
        name: 'A Seller',
        slug: 'a-seller',
        passwordHash,
        emailVerified: true,
      },
    });
    sellerId = seller.id;
    sellerToken = await login(app, 'a-seller@example.com');

    const buyer = await prisma.user.create({
      data: {
        email: 'a-buyer@example.com',
        name: 'A Buyer',
        slug: 'a-buyer',
        passwordHash,
        emailVerified: true,
      },
    });
    buyerId = buyer.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  let n = 0;
  /**
   * Crea un anuncio directamente en la BD, en el estado pedido. Vía Prisma y no
   * vía API a propósito: varios estados de partida (ARCHIVED, SOLD, EXPIRED) no
   * son alcanzables por HTTP sin recorrer medio ciclo de vida, y lo que se está
   * probando es el SALTO, no cómo se llegó al origen.
   */
  async function seedListing(
    status: ListingStatus,
    opts: { ownerId?: string; type?: 'PRODUCT' | 'SERVICE' } = {},
  ): Promise<string> {
    n += 1;
    const listing = await prisma.listing.create({
      data: {
        title: `A-ráfaga listing ${n}`,
        slug: `a-rafaga-listing-${n}-${Date.now()}`,
        description: 'Anuncio de la ráfaga (A)',
        price: new Prisma.Decimal('10.00'),
        type: opts.type ?? 'PRODUCT',
        priceType: 'FIXED',
        condition: opts.type === 'SERVICE' ? null : 'GOOD',
        status,
        sellerId: opts.ownerId ?? sellerId,
        categoryId,
        ...(status === ListingStatus.ACTIVE || status === ListingStatus.EXPIRED
          ? { publishedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 86_400_000) }
          : {}),
      },
    });
    return listing.id;
  }

  /** Deja al vendedor EXACTAMENTE en el tope de activos del plan free. */
  async function fillQuota(ownerId: string = sellerId): Promise<void> {
    const activos = await prisma.listing.count({
      where: { sellerId: ownerId, status: ListingStatus.ACTIVE },
    });
    for (let i = activos; i < FREE_LIMIT; i++) {
      await seedListing(ListingStatus.ACTIVE, { ownerId });
    }
  }

  /** Vacía los activos del vendedor para que la cuota deje de estorbar. */
  async function clearQuota(ownerId: string = sellerId): Promise<void> {
    await prisma.listing.deleteMany({
      where: { sellerId: ownerId, status: ListingStatus.ACTIVE },
    });
  }

  function changeStatus(listingId: string, status: string) {
    return request(app.getHttpServer())
      .patch(`/api/admin/listings/${listingId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status, reason: 'Test ráfaga A' });
  }

  // ===========================================================================
  // A1 — LA MÁQUINA DE ESTADOS
  // ===========================================================================

  describe('A1 — ARCHIVED es terminal', () => {
    it('ARCHIVED → ACTIVE se rechaza con 400 (EL bug: resucitar lo irreversible)', async () => {
      const id = await seedListing(ListingStatus.ARCHIVED);

      const res = await changeStatus(id, 'ACTIVE').expect(400);
      expect(res.body.message).toContain('estado final');

      // Y no solo devuelve 400: no escribe nada.
      const after = await prisma.listing.findUniqueOrThrow({ where: { id } });
      expect(after.status).toBe(ListingStatus.ARCHIVED);
    });

    it('ARCHIVED → DRAFT también se rechaza (terminal en TODAS las direcciones)', async () => {
      const id = await seedListing(ListingStatus.ARCHIVED);
      await changeStatus(id, 'DRAFT').expect(400);
    });

    it('ARCHIVED → ARCHIVED pasa: mismo estado es un no-op, no un salto', async () => {
      const id = await seedListing(ListingStatus.ARCHIVED);
      await changeStatus(id, 'ARCHIVED').expect(200);
    });
  });

  describe('A1 — no se estampan a mano los estados que produce un flujo', () => {
    it('DRAFT → SOLD se rechaza (un SOLD sin Deal es un callejón sin salida)', async () => {
      const id = await seedListing(ListingStatus.DRAFT);
      const res = await changeStatus(id, 'SOLD').expect(400);
      expect(res.body.message).toContain('Borrador');
    });

    it('DRAFT → RESERVED se rechaza (reservar describe algo de un anuncio publicado)', async () => {
      const id = await seedListing(ListingStatus.DRAFT);
      await changeStatus(id, 'RESERVED').expect(400);
    });

    it('DRAFT → REJECTED se rechaza (no hay nada publicado que rechazar)', async () => {
      const id = await seedListing(ListingStatus.DRAFT);
      await changeStatus(id, 'REJECTED').expect(400);
    });

    it('DRAFT → ARCHIVED se rechaza (mismo criterio que archive(): nada publicado aún)', async () => {
      const id = await seedListing(ListingStatus.DRAFT);
      await changeStatus(id, 'ARCHIVED').expect(400);
    });

    it('el motivo dice qué SÍ se puede hacer, no solo que no', async () => {
      const id = await seedListing(ListingStatus.DRAFT);
      const res = await changeStatus(id, 'SOLD').expect(400);
      expect(res.body.message).toContain('Activo');
      expect(res.body.message).toContain('En revisión');
    });
  });

  describe('A1 — las transiciones LEGALES siguen intactas (regresión)', () => {
    it('PENDING_REVIEW → ACTIVE sigue funcionando y fija expiresAt', async () => {
      await clearQuota();
      const id = await seedListing(ListingStatus.PENDING_REVIEW);

      const res = await changeStatus(id, 'ACTIVE').expect(200);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.expiresAt).not.toBeNull();
    });

    it('ACTIVE → REJECTED sigue funcionando', async () => {
      const id = await seedListing(ListingStatus.ACTIVE);
      const res = await changeStatus(id, 'REJECTED').expect(200);
      expect(res.body.status).toBe('REJECTED');
    });

    it('EXPIRED → ACTIVE sigue funcionando', async () => {
      await clearQuota();
      const id = await seedListing(ListingStatus.EXPIRED);
      await changeStatus(id, 'ACTIVE').expect(200);
    });

    it('ACTIVE → ACTIVE (re-guardado idempotente) no se rompe', async () => {
      await clearQuota();
      const id = await seedListing(ListingStatus.ACTIVE);
      await changeStatus(id, 'ACTIVE').expect(200);
    });

    it('ACTIVE → PENDING_REVIEW sigue disponible para el moderador', async () => {
      const id = await seedListing(ListingStatus.ACTIVE);
      await changeStatus(id, 'PENDING_REVIEW').expect(200);
    });
  });

  // ===========================================================================
  // A2 — LA CUOTA EN LOS CAMINOS DE VENDEDOR
  // ===========================================================================

  describe('A2 — undoDeal (SOLD → ACTIVE) ahora respeta la cuota', () => {
    /** Publica, cierra el trato (queda SOLD) y devuelve listingId + dealId. */
    async function venderProducto(): Promise<{ listingId: string; dealId: string }> {
      const listingId = await seedListing(ListingStatus.ACTIVE);
      const dealRes = await request(app.getHttpServer())
        .post(`/api/listings/${listingId}/deals`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ buyerId })
        .expect(201);
      return { listingId, dealId: dealRes.body.deal.id as string };
    }

    it('con el cupo lleno, deshacer el trato se bloquea con 403 (EL agujero que se cierra)', async () => {
      await clearQuota();
      const { listingId, dealId } = await venderProducto();
      // El anuncio ya está en SOLD, así que NO cuenta: se llena el cupo con otros.
      await fillQuota();

      const res = await request(app.getHttpServer())
        .delete(`/api/listings/${listingId}/deals/${dealId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(403);
      expect(res.body.message).toContain('límite');

      // Ni resucita el anuncio ni borra el trato: la operación entera no ocurre.
      const after = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
      expect(after.status).toBe(ListingStatus.SOLD);
      expect(await prisma.deal.findUnique({ where: { id: dealId } })).not.toBeNull();
    });

    it('con hueco en el cupo, deshacer el trato sigue funcionando igual que antes (regresión)', async () => {
      await clearQuota();
      const { listingId, dealId } = await venderProducto();

      const res = await request(app.getHttpServer())
        .delete(`/api/listings/${listingId}/deals/${dealId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      expect(res.body.status).toBe('ACTIVE');
      expect(await prisma.deal.findUnique({ where: { id: dealId } })).toBeNull();
    });

    it('un SERVICIO deshace su trato aunque el cupo esté lleno: no cambia de estado', async () => {
      await clearQuota();
      const listingId = await seedListing(ListingStatus.ACTIVE, { type: 'SERVICE' });
      const dealRes = await request(app.getHttpServer())
        .post(`/api/listings/${listingId}/deals`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ buyerId })
        .expect(201);
      // El servicio sigue ACTIVE tras cerrar el trato, así que ya ocupa plaza.
      await fillQuota();

      await request(app.getHttpServer())
        .delete(`/api/listings/${listingId}/deals/${dealRes.body.deal.id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
    });
  });

  describe('A2 — decisiones MANTENIDAS a propósito (PINNED, no aspiracional)', () => {
    /**
     * PINNED — el 5.º camino latente (auditoría §1.5). Un SERVICIO en RESERVED
     * vuelve a ACTIVE al cerrar el trato sin mirar la cuota, porque RESERVED no
     * cuenta como plaza ocupada. NO se cierra en esta ráfaga: bloquearlo perdería
     * un hecho ya ocurrido (el Deal, la conversación y los avisos de valoración),
     * y la causa raíz —qué cuenta la cuota— cambiaría publish/renew/reactivate
     * para todo el mundo. Ver el comentario de closeDeal() y la auditoría §1.5.
     */
    it('closeDeal de un SERVICIO reservado sigue pasando con el cupo lleno', async () => {
      await clearQuota();
      const listingId = await seedListing(ListingStatus.RESERVED, { type: 'SERVICE' });
      await fillQuota();

      const res = await request(app.getHttpServer())
        .post(`/api/listings/${listingId}/deals`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ buyerId })
        .expect(201);
      expect(res.body.listing.status).toBe('ACTIVE');
    });

    /**
     * PINNED — política de staff. Moderación y admin NO comprueban la cuota, y
     * eso se mantiene: cerrarlo dejaría el trabajo de staff rehén de la cuota de
     * un tercero (si el vendedor llena su cupo mientras el anuncio espera
     * revisión, el moderador ya no podría aprobarlo). Es decisión de producto
     * pendiente — ver docs/auditoria-puerta-validacion.md, D3.
     */
    it('approveListing (staff) sigue exento de la cuota', async () => {
      await clearQuota();
      const id = await seedListing(ListingStatus.PENDING_REVIEW);
      await fillQuota();

      await request(app.getHttpServer())
        .post(`/api/moderation/listings/${id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('changeListingStatus (staff) sigue exento de la cuota', async () => {
      await clearQuota();
      const id = await seedListing(ListingStatus.PENDING_REVIEW);
      await fillQuota();

      await changeStatus(id, 'ACTIVE').expect(200);
    });
  });
});
