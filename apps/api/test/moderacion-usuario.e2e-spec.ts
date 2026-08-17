/**
 * MODERACIÓN PREVIA — RÁFAGA M4: EL NIVEL USUARIO, Y LA CONFIANZA.
 *
 * El tercer disparador completa la fórmula:
 *
 *     requiereRevisión =
 *          usuario.requiresReview                       ← específica
 *       OR categoría-o-ancestro.requiresReview          ← específica
 *       OR (plataforma AND NOT (trusted Y exención))    ← genérica, eximible
 *
 * LO QUE ESTA SUITE FIJA, y que es toda la decisión de M4: **la marca específica
 * gana a la confianza; la red genérica se puede eximir.** Marcar a un vendedor o
 * una rama es señalar algo que alguien ha mirado; «reviso a todo el mundo» es una
 * red. Que la confianza levante la red es razonable; que anule una señal puesta a
 * dedo sería sustituir la decisión más informada por la menos informada.
 *
 * Y la exención NACE APAGADA, porque hoy `trusted` es puramente cosmético: darle
 * poder de golpe eximiría a vendedores marcados hace meses de una revisión que
 * nadie decidió eximirles.
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import {
  PRE_MODERATION_ALL_SETTING,
  PRE_MODERATION_TRUSTED_EXEMPT_SETTING,
} from 'src/modules/moderation/pre-moderation.service';

describe('Moderación M4 — el nivel usuario y la confianza (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let movilesId: string;
  let sellerId: string;
  let sellerToken: string;
  let adminId: string;
  let adminToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    movilesId = cat.id;

    const passwordHash = await bcrypt.hash('Test1234!', 4);
    const seller = await prisma.user.create({
      data: { email: 'm4-seller@example.com', name: 'M4 Seller', slug: 'm4-seller', passwordHash, emailVerified: true },
    });
    sellerId = seller.id;
    const admin = await prisma.user.create({
      data: { email: 'm4-admin@example.com', name: 'M4 Admin', slug: 'm4-admin', passwordHash, emailVerified: true, role: 'ADMIN' },
    });
    adminId = admin.id;

    const [s, a] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'm4-seller@example.com', password: 'Test1234!' }),
      request(app.getHttpServer()).post('/api/auth/admin-login').send({ email: 'm4-admin@example.com', password: 'Test1234!' }),
    ]);
    sellerToken = s.body.accessToken as string;
    adminToken = a.body.accessToken as string;
  });

  afterEach(async () => {
    await prisma.setting.deleteMany({
      where: {
        key: { in: [PRE_MODERATION_ALL_SETTING, PRE_MODERATION_TRUSTED_EXEMPT_SETTING] },
      },
    });
    await prisma.user.update({
      where: { id: sellerId },
      data: { requiresReview: false, trusted: false },
    });
    await prisma.category.update({ where: { id: movilesId }, data: { requiresReview: false } });
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.listing.deleteMany({ where: { sellerId } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ===========================================================================
  // Utilidades
  // ===========================================================================

  async function encender(key: string): Promise<void> {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: true },
      update: { value: true },
    });
  }

  async function marcarVendedor(campos: { requiresReview?: boolean; trusted?: boolean }) {
    await prisma.user.update({ where: { id: sellerId }, data: campos });
  }

  let n = 0;
  async function seedDraft(): Promise<string> {
    n += 1;
    const l = await prisma.listing.create({
      data: {
        title: `M4 ${n}`,
        slug: `m4-${n}-${Date.now()}`,
        description: 'Anuncio de la suite del nivel usuario',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.DRAFT,
        sellerId,
        categoryId: movilesId,
      },
      select: { id: true },
    });
    return l.id;
  }

  async function publicarYObtenerEstado(): Promise<string> {
    const id = await seedDraft();
    const res = await request(app.getHttpServer())
      .post(`/api/listings/${id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    return res.body.status as string;
  }

  // ===========================================================================
  // 1 · APAGADO — el requisito de oro
  // ===========================================================================

  it('sin nada marcado, publicar sigue llevando a ACTIVE', async () => {
    expect(await publicarYObtenerEstado()).toBe('ACTIVE');
  });

  // ===========================================================================
  // 2 · EL NIVEL USUARIO
  // ===========================================================================

  describe('Nivel usuario', () => {
    it('un vendedor marcado va a revisión, aunque plataforma y categoría estén apagadas', async () => {
      await marcarVendedor({ requiresReview: true });
      expect(await publicarYObtenerEstado()).toBe('PENDING_REVIEW');
    });

    it('desmarcarlo lo devuelve a publicar con normalidad', async () => {
      await marcarVendedor({ requiresReview: true });
      expect(await publicarYObtenerEstado()).toBe('PENDING_REVIEW');

      await marcarVendedor({ requiresReview: false });
      expect(await publicarYObtenerEstado()).toBe('ACTIVE');
    });

    it('se marca y se desmarca desde la API de admin, y queda registrado', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/users/${sellerId}/requires-review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ requiresReview: true })
        .expect(200);
      expect(await publicarYObtenerEstado()).toBe('PENDING_REVIEW');

      // Quién marcó a quién es justo lo que hay que poder reconstruir.
      const registro = await prisma.auditLog.findFirst({
        where: { action: 'USER_REQUIRE_REVIEW', resourceId: sellerId },
      });
      expect(registro).not.toBeNull();

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${sellerId}/requires-review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ requiresReview: false })
        .expect(200);
      expect(await publicarYObtenerEstado()).toBe('ACTIVE');
    });
  });

  // ===========================================================================
  // 3 · LA CONFIANZA — qué levanta y qué no
  // ===========================================================================

  describe('La confianza sólo levanta la red GENÉRICA', () => {
    it('trusted NO exime por sí solo: sin la exención encendida, «todos» es todos', async () => {
      // La mitad más importante de M4. Hoy `trusted` es una insignia decorativa;
      // que empezara a eximir sin que nadie lo decida sería cambiar, con efecto
      // retroactivo, lo que significa una marca ya puesta.
      await marcarVendedor({ trusted: true });
      await encender(PRE_MODERATION_ALL_SETTING);

      expect(await publicarYObtenerEstado()).toBe('PENDING_REVIEW');
    });

    it('con la exención encendida, un trusted se salta la revisión de PLATAFORMA', async () => {
      await marcarVendedor({ trusted: true });
      await encender(PRE_MODERATION_ALL_SETTING);
      await encender(PRE_MODERATION_TRUSTED_EXEMPT_SETTING);

      expect(await publicarYObtenerEstado()).toBe('ACTIVE');
    });

    it('…pero un NO trusted sigue yendo a revisión (la exención no es un apagado)', async () => {
      // Control: sin esto, una exención que eximiera a todo el mundo pasaría el
      // test de arriba pareciendo correcta.
      await encender(PRE_MODERATION_ALL_SETTING);
      await encender(PRE_MODERATION_TRUSTED_EXEMPT_SETTING);

      expect(await publicarYObtenerEstado()).toBe('PENDING_REVIEW');
    });

    it('LA ESPECÍFICA GANA: un trusted en una CATEGORÍA que exige revisión, se revisa', async () => {
      await marcarVendedor({ trusted: true });
      await encender(PRE_MODERATION_TRUSTED_EXEMPT_SETTING);
      await prisma.category.update({ where: { id: movilesId }, data: { requiresReview: true } });

      expect(await publicarYObtenerEstado()).toBe('PENDING_REVIEW');
    });

    it('LA ESPECÍFICA GANA: un trusted MARCADO para revisión, se revisa', async () => {
      // Los dos ejes a la vez, que es lo que demuestra que no son opuestos: se
      // puede ser de confianza Y estar marcado, y entonces manda la marca.
      await marcarVendedor({ trusted: true, requiresReview: true });
      await encender(PRE_MODERATION_TRUSTED_EXEMPT_SETTING);
      await encender(PRE_MODERATION_ALL_SETTING);

      expect(await publicarYObtenerEstado()).toBe('PENDING_REVIEW');
    });

    it('la exención sola, sin revisión de plataforma, no hace nada', async () => {
      await marcarVendedor({ trusted: true });
      await encender(PRE_MODERATION_TRUSTED_EXEMPT_SETTING);

      expect(await publicarYObtenerEstado()).toBe('ACTIVE');
    });
  });
});
