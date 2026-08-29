import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { ExpirationService } from 'src/modules/expiration/expiration.service';
import { ListingLifecycleNotificationsService } from 'src/modules/listing-lifecycle-notifications/listing-lifecycle-notifications.service';
import { NOTIFICATION_JOB } from 'src/infra/queue/notification.types';

/**
 * NOTIFICACIONES N3 — EL CICLO DE VIDA DEL ANUNCIO.
 *
 * ── EL HUECO QUE CIERRA ─────────────────────────────────────────────────────
 *
 * `LISTING_MODERATED` cubría las decisiones del staff. Lo que le pasa al anuncio
 * por el camino no lo cubría nadie, y el caso caro es **expirar**: el cron de las
 * 02:00 lo sacaba del marketplace y su dueño no se enteraba — «desapareció y no sé
 * por qué», el evento de más valor de todo §A3.1.
 *
 * ── LO QUE ESTA SUITE FIJA, SOBRE TODO ──────────────────────────────────────
 *
 * **QUE EL PREAVISO NO SPAMEE.** La ventana «caduca dentro de 7 días» la cumple el
 * mismo anuncio siete días seguidos; sin idempotencia, el cron diario manda siete
 * avisos y siete correos por anuncio. Es la única parte de N3 que no es un
 * enganche directo, y por eso es la barrera.
 */
describe('Ciclo de vida del anuncio — avisos al dueño (N3) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let expiration: ExpirationService;
  let addSpy: jest.SpyInstance;

  let vendedor: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    expiration = app.get(ExpirationService);

    // La cola QUE EL SERVICIO TIENE INYECTADA, no la del `app.get` global: varios
    // módulos registran la misma cola por nombre y cada registro crea su propia
    // instancia. Molde de `moderation-notifications.e2e-spec.ts`.
    const queue = (
      app.get(ListingLifecycleNotificationsService) as unknown as {
        queue: { add: (...a: unknown[]) => unknown };
      }
    ).queue;
    addSpy = jest.spyOn(queue, 'add').mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
    addSpy.mockRestore();
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    addSpy.mockClear();
    const id = randomUUID().slice(0, 8);
    vendedor = (
      await prisma.user.create({
        data: { email: `cv-${id}@test.local`, name: `Cv ${id}`, slug: `cv-${id}` },
      })
    ).id;
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  /** Un anuncio ACTIVE que caduca dentro de `enDias` (negativo = ya caducado). */
  async function anuncio(enDias: number, extra: Record<string, unknown> = {}) {
    return prisma.listing.create({
      data: {
        title: 'Bici de carretera',
        slug: `cv-${randomUUID().slice(0, 8)}`,
        description: 'descripción',
        price: 100,
        type: 'PRODUCT',
        sellerId: vendedor,
        categoryId,
        status: 'ACTIVE',
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + enDias * 24 * 60 * 60 * 1000),
        ...extra,
      },
    });
  }

  const avisos = (action?: string) =>
    prisma.notification.findMany({
      where: { userId: vendedor, type: 'LISTING_LIFECYCLE' },
    }).then((todas) =>
      action
        ? todas.filter((n) => (n.data as Record<string, unknown>).action === action)
        : todas,
    );

  const correos = () =>
    addSpy.mock.calls
      .filter((c) => c[0] === NOTIFICATION_JOB.SEND_LISTING_LIFECYCLE)
      .map((c) => c[1] as Record<string, unknown>);

  // ===========================================================================
  // BARRERA 1 — expirar avisa
  // ===========================================================================

  describe('caducar (el caso «desapareció y no sé por qué»)', () => {
    it('el cron marca EXPIRED y AVISA a su dueño, por los dos canales', async () => {
      const l = await anuncio(-1);

      await expiration.expireListings();

      expect(
        (await prisma.listing.findUniqueOrThrow({ where: { id: l.id } })).status,
      ).toBe('EXPIRED');

      const [aviso] = await avisos('EXPIRED');
      expect(aviso).toBeDefined();
      // Título CONGELADO en el snapshot: el aviso se pinta sin consultas.
      expect((aviso.data as Record<string, unknown>).listingTitle).toBe('Bici de carretera');

      const [correo] = correos();
      expect(correo.action).toBe('EXPIRED');
    });

    it('un anuncio que aún no ha caducado no recibe nada', async () => {
      await anuncio(30);
      await expiration.expireListings();

      expect(await avisos()).toHaveLength(0);
    });
  });

  // ===========================================================================
  // BARRERA 2 — EL PREAVISO NO SPAMEA (la clave de N3)
  // ===========================================================================

  describe('preaviso de caducidad — la idempotencia', () => {
    it('avisa una vez, con los días que quedan', async () => {
      await anuncio(3);

      await expiration.warnExpiringListings();

      const [aviso] = await avisos('EXPIRING_SOON');
      expect(aviso).toBeDefined();
      expect((aviso.data as Record<string, unknown>).daysLeft).toBe(3);
      expect(correos()[0].action).toBe('EXPIRING_SOON');
    });

    /**
     * LA BARRERA. Sin `expiryWarnedFor`, estas siete pasadas producen SIETE avisos
     * y siete correos sobre el mismo anuncio: la ventana no se cierra sola y el
     * cron no recuerda nada.
     */
    it('SIETE pasadas del cron sobre el mismo anuncio → UN solo aviso', async () => {
      await anuncio(6);

      for (let i = 0; i < 7; i++) {
        await expiration.warnExpiringListings();
      }

      expect(await avisos('EXPIRING_SOON')).toHaveLength(1);
      expect(correos()).toHaveLength(1);
    });

    it('deja la marca contra el vencimiento preavisado, no un simple «ya avisé»', async () => {
      const l = await anuncio(4);

      await expiration.warnExpiringListings();

      const despues = await prisma.listing.findUniqueOrThrow({ where: { id: l.id } });
      expect(despues.expiryWarnedFor).not.toBeNull();
      expect(despues.expiryWarnedFor!.getTime()).toBe(despues.expiresAt!.getTime());
    });

    /**
     * LA RAZÓN DE QUE LA MARCA SEA UNA FECHA Y NO UN BOOLEANO: al renovar, el
     * vencimiento cambia y el anuncio VUELVE a ser preavisable — sin que nadie
     * tenga que limpiar nada en los cinco sitios que escriben `expiresAt`.
     */
    it('tras renovar (nuevo vencimiento) vuelve a preavisar', async () => {
      const l = await anuncio(5);
      await expiration.warnExpiringListings();
      expect(await avisos('EXPIRING_SOON')).toHaveLength(1);

      // Renovación: el vencimiento se mueve. La marca vieja deja de coincidir.
      await prisma.listing.update({
        where: { id: l.id },
        data: { expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) },
      });

      await expiration.warnExpiringListings();
      expect(await avisos('EXPIRING_SOON')).toHaveLength(2);
    });

    it('fuera de la ventana de 7 días no se preavisa', async () => {
      await anuncio(30);
      await expiration.warnExpiringListings();

      expect(await avisos('EXPIRING_SOON')).toHaveLength(0);
    });

    it('lo YA caducado no se preavisa: eso es trabajo del cron de las 02:00', async () => {
      await anuncio(-2);
      await expiration.warnExpiringListings();

      expect(await avisos('EXPIRING_SOON')).toHaveLength(0);
    });

    it('un anuncio que no está ACTIVE no se preavisa', async () => {
      await anuncio(3, { status: 'PAUSED' });
      await expiration.warnExpiringListings();

      expect(await avisos('EXPIRING_SOON')).toHaveLength(0);
    });
  });

  // ===========================================================================
  // BARRERA 7 — no notificar acciones propias
  // ===========================================================================

  it('caducar y preavisar son lo ÚNICO que estos crones avisan: nada más se cuela', async () => {
    // Uno lejos de caducar: ni el cron de caducidad ni el de preaviso deben tocarlo.
    await anuncio(45);

    await expiration.expireListings();
    await expiration.warnExpiringListings();

    expect(await avisos()).toHaveLength(0);
    expect(correos()).toHaveLength(0);
  });
});
