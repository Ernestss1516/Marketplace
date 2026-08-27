/**
 * MODERACIÓN PREVIA — RÁFAGA M2: APROBAR PASA LA PUERTA, Y AVISA.
 *
 * LA LÍNEA QUE ESTA SUITE FIJA, y que es toda la ráfaga en una frase: **al
 * aprobar se comprueban las reglas sobre el ANUNCIO y no las reglas sobre el
 * VENDEDOR.**
 *
 *  · Del ANUNCIO (fotos, atributos): el moderador las está mirando, y si algo
 *    falta tiene por dónde salir — devolver el anuncio a borrador. Aplicarlas es
 *    lo que impide que la revisión publique lo que el propio editor rechazaría.
 *  · Del VENDEDOR (cuota de activos, correo verificado): el moderador NO puede
 *    arreglarlas. Aplicarlas dejaría su trabajo rehén de un tercero — un anuncio
 *    atrapado en la cola para siempre porque su dueño llenó el cupo o no ha
 *    verificado el correo.
 *
 * Y la otra mitad: aprobar AVISA. Era la única de las cuatro acciones de
 * moderación que no decía nada al vendedor.
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { preservarAjustes } from './helpers/settings';
import { pollUntil } from './helpers/poll';
import {
  MIN_PHOTOS_RULE_ENABLED_SETTING,
  NOT_ENOUGH_PHOTOS_CODE,
} from 'src/modules/listing-gate/photo-limits';
import { EMAIL_VERIFIED_RULE_ENABLED_SETTING } from 'src/modules/listing-gate/rules/email-verified.rule';

const LIMITE_ACTIVOS = 'freeActiveListingLimit';

describe('Moderación M2 — aprobar pasa la puerta y avisa (e2e)', () => {
  // El `afterEach` de más abajo repone el tope a 5 entre casos, y eso está bien: es
  // aislamiento DENTRO de la suite. Lo que no puede hacer es servir de restauración
  // hacia fuera, porque ese 5 es un LITERAL — vale lo que vale la semilla hoy, y el
  // día que cambie esta suite dejará el tope equivocado para todas las siguientes sin
  // que nada lo avise. `preservarAjustes` guarda la fila de verdad. Ver A2 en
  // `docs/auditoria-deuda-test-ci.md` §2 y `helpers/settings.ts`.
  preservarAjustes([LIMITE_ACTIVOS]);

  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;
  let sellerId: string;
  let adminId: string;
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
      data: { email: 'm2-seller@example.com', name: 'M2 Seller', slug: 'm2-seller', passwordHash, emailVerified: false },
    });
    sellerId = seller.id;
    const admin = await prisma.user.create({
      data: { email: 'm2-admin@example.com', name: 'M2 Admin', slug: 'm2-admin', passwordHash, emailVerified: true, role: 'ADMIN' },
    });
    adminId = admin.id;

    adminToken = (
      await request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'm2-admin@example.com', password: 'Test1234!' })
    ).body.accessToken as string;
  });

  afterEach(async () => {
    await prisma.setting.deleteMany({
      where: { key: { in: [MIN_PHOTOS_RULE_ENABLED_SETTING, EMAIL_VERIFIED_RULE_ENABLED_SETTING] } },
    });
    await prisma.setting.upsert({
      where: { key: LIMITE_ACTIVOS },
      create: { key: LIMITE_ACTIVOS, value: 5 },
      update: { value: 5 },
    });
    await prisma.notification.deleteMany({ where: { userId: sellerId } });
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.listingImage.deleteMany({ where: { uploadedById: sellerId } });
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

  let n = 0;
  async function seedPendiente(conFotos = 1): Promise<string> {
    n += 1;
    const l = await prisma.listing.create({
      data: {
        title: `Pendiente ${n}`,
        slug: `pendiente-m2-${n}-${Date.now()}`,
        description: 'Anuncio esperando revisión',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.PENDING_REVIEW,
        sellerId,
        categoryId,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    for (let i = 0; i < conFotos; i++) {
      n += 1;
      await prisma.listingImage.create({
        data: { url: `https://example.test/m2-${n}.jpg`, uploadedById: sellerId, listingId: l.id },
      });
    }
    return l.id;
  }

  function aprobar(id: string) {
    return request(app.getHttpServer())
      .post(`/api/moderation/listings/${id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  async function estado(id: string): Promise<ListingStatus> {
    const l = await prisma.listing.findUniqueOrThrow({ where: { id }, select: { status: true } });
    return l.status;
  }

  async function avisosDelVendedor() {
    return prisma.notification.findMany({
      where: { userId: sellerId, type: 'LISTING_MODERATED' },
      select: { data: true },
    });
  }

  // ===========================================================================
  // 1 · LAS REGLAS DEL ANUNCIO SÍ SE COMPRUEBAN
  // ===========================================================================

  describe('Reglas del ANUNCIO', () => {
    it('un anuncio SIN FOTOS no se puede aprobar, y se queda en la cola', async () => {
      const id = await seedPendiente(0);
      await encender(MIN_PHOTOS_RULE_ENABLED_SETTING);

      const res = await aprobar(id).expect(422);
      expect(res.body.code).toBe(NOT_ENOUGH_PHOTOS_CODE);

      // NO se pierde: sigue esperando a que alguien haga algo con él. La salida
      // del moderador es devolverlo a borrador, no aprobarlo a la fuerza.
      expect(await estado(id)).toBe(ListingStatus.PENDING_REVIEW);
    });

    it('con la regla de fotos APAGADA, el mismo anuncio se aprueba', async () => {
      // Control: lo que frena es la regla, no el hecho de aprobar.
      const id = await seedPendiente(0);

      await aprobar(id).expect(200);
      expect(await estado(id)).toBe(ListingStatus.ACTIVE);
    });

    it('con fotos suficientes se aprueba aunque la regla esté encendida', async () => {
      const id = await seedPendiente(1);
      await encender(MIN_PHOTOS_RULE_ENABLED_SETTING);

      await aprobar(id).expect(200);
      expect(await estado(id)).toBe(ListingStatus.ACTIVE);
    });
  });

  // ===========================================================================
  // 2 · LAS REGLAS DEL VENDEDOR NO
  // ===========================================================================

  describe('Reglas del VENDEDOR — el moderador no es rehén', () => {
    it('el vendedor con el CUPO LLENO: su anuncio se aprueba igual', async () => {
      await prisma.setting.upsert({
        where: { key: LIMITE_ACTIVOS },
        create: { key: LIMITE_ACTIVOS, value: 1 },
        update: { value: 1 },
      });
      // Un activo ya ocupa todo el cupo.
      n += 1;
      await prisma.listing.create({
        data: {
          title: `Ocupa cupo ${n}`,
          slug: `ocupa-cupo-${n}-${Date.now()}`,
          description: 'x',
          price: new Prisma.Decimal('10.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: ListingStatus.ACTIVE,
          sellerId,
          categoryId,
          publishedAt: new Date(),
          expiresAt: new Date(Date.now() + 60 * 86_400_000),
        },
      });
      const id = await seedPendiente(1);

      // Si la cuota aplicara aquí, el moderador no podría cerrar este trabajo
      // hasta que el VENDEDOR despublicara otro anuncio.
      await aprobar(id).expect(200);
      expect(await estado(id)).toBe(ListingStatus.ACTIVE);
    });

    it('el vendedor SIN CORREO VERIFICADO: su anuncio se aprueba igual', async () => {
      const id = await seedPendiente(1);
      await encender(EMAIL_VERIFIED_RULE_ENABLED_SETTING);

      // El vendedor de esta suite nace con `emailVerified: false`. Verificar el
      // correo es cosa suya y de otra pantalla: el moderador no puede hacerlo.
      await aprobar(id).expect(200);
      expect(await estado(id)).toBe(ListingStatus.ACTIVE);
    });
  });

  // ===========================================================================
  // 3 · EL AVISO QUE FALTABA
  // ===========================================================================

  describe('Aprobar avisa al vendedor', () => {
    it('deja un aviso APPROVED y registra LISTING_APPROVE', async () => {
      const id = await seedPendiente(1);

      await aprobar(id).expect(200);

      const avisos = await avisosDelVendedor();
      expect(avisos).toHaveLength(1);
      expect((avisos[0].data as { action: string }).action).toBe('APPROVED');

      const registro = await prisma.auditLog.findFirst({
        where: { action: 'LISTING_APPROVE', resourceId: id },
      });
      expect(registro).not.toBeNull();
    });

    it('rechazar sigue avisando como siempre, con su motivo', async () => {
      // M2 no cambia `rejectListing`: se comprueba que sigue haciendo lo que ya
      // hacía, porque el frontend pasa a usarlo de verdad.
      const id = await seedPendiente(1);

      await request(app.getHttpServer())
        .post(`/api/moderation/listings/${id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Fotos que no son del producto' })
        .expect(200);

      expect(await estado(id)).toBe(ListingStatus.REJECTED);
      await pollUntil(async () => (await avisosDelVendedor()).length === 1);
      const [aviso] = await avisosDelVendedor();
      expect((aviso.data as { action: string; reason: string }).action).toBe('REJECTED');
      expect((aviso.data as { reason: string }).reason).toBe('Fotos que no son del producto');
    });
  });
});
