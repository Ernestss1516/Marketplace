import { randomUUID } from 'crypto';
import { ForbiddenException, INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { preservarAjustes, sinAjustes, withSetting } from './helpers/settings';
import { ListingsService } from 'src/modules/listings/listings.service';
import { MessagingService } from 'src/modules/messaging/messaging.service';
import { DEFAULT_EXPIRY_DAYS } from 'src/modules/expiration/listing-expiry';

/**
 * AJUSTES RÁFAGA A — LAS BARRERAS DE «LOS AJUSTES DICEN LA VERDAD».
 *
 * Esta suite no prueba features: prueba que la página de ajustes **no puede volver a mentir**.
 * Cada bloque de aquí es una de las barreras de docs/auditoria-ajustes-backoffice.md §8, y cada
 * uno está escrito para ponerse rojo ante una mutación concreta, nombrada en su cabecera.
 *
 * El defecto que justifica la suite entera: `listingExpiryDays` y `contactRequiresVerification`
 * llevaban desde el MVP sembrados, editables y **sin un solo lector**. Nada podía detectarlo
 * porque no había nada que lo mirara. Esto es lo que mira.
 */
describe('Ajustes ráfaga A — los ajustes dicen la verdad (e2e)', () => {
  // La suite escribe estas claves por la vía real (el PATCH de admin) y las devuelve a su fila
  // exacta al terminar, ausencia incluida. Ver `helpers/settings.ts`.
  preservarAjustes([
    'listingExpiryDays',
    'contactRequiresVerification',
    'fiscalInvoicingPeriodicity',
    'fiscalSelfServiceWindow',
    'messageEmailGraceMinutes',
    'defaultSuspensionDays',
  ]);

  let app: INestApplication;
  let prisma: PrismaClient;
  let listings: ListingsService;

  let adminToken: string;
  let vendedorId: string;
  let categoryId: string;

  const sufijo = randomUUID().slice(0, 8);

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    listings = app.get(ListingsService);

    const passwordHash = await bcrypt.hash('Password123!', 10);
    const admin = await prisma.user.create({
      data: {
        email: `ajustes-a-admin-${sufijo}@test.local`,
        name: 'Admin ajustes A',
        slug: `ajustes-a-admin-${sufijo}`,
        passwordHash,
        role: 'ADMIN',
        emailVerified: true,
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: admin.email, password: 'Password123!' })
      .expect(200);
    adminToken = login.body.accessToken;

    vendedorId = (
      await prisma.user.create({
        data: {
          email: `ajustes-a-vend-${sufijo}@test.local`,
          name: 'Vendedor ajustes A',
          slug: `ajustes-a-vend-${sufijo}`,
          passwordHash,
          emailVerified: true,
        },
      })
    ).id;
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await prisma.listing.deleteMany({ where: { sellerId: vendedorId } });
    // Los PATCH de esta suite dejan un `SETTING_UPDATE` por cada uno, con el admin como
    // actor: sin borrarlos primero, la FK `AuditLog_actorId_fkey` impide borrar al usuario.
    // Es la prueba, de paso, de que cada cambio de ajuste queda registrado.
    const usuarios = await prisma.user.findMany({
      where: {
        email: {
          in: [`ajustes-a-admin-${sufijo}@test.local`, `ajustes-a-vend-${sufijo}@test.local`],
        },
      },
      select: { id: true },
    });
    const ids = usuarios.map((u) => u.id);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
    await prisma.$disconnect();
  });

  const patchSetting = (key: string, value: unknown) =>
    request(app.getHttpServer())
      .patch(`/api/admin/settings/${key}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value });

  /** Un BORRADOR listo para publicarse. La caducidad se calcula al publicar, no aquí. */
  async function borrador() {
    return prisma.listing.create({
      data: {
        title: 'Bici de carretera',
        slug: `ajustes-a-${randomUUID().slice(0, 8)}`,
        description: 'descripción de prueba con longitud suficiente',
        price: 100,
        type: 'PRODUCT',
        sellerId: vendedorId,
        categoryId,
        status: 'DRAFT',
      },
    });
  }

  const diasHasta = (desde: Date, hasta: Date) =>
    Math.round((hasta.getTime() - desde.getTime()) / (24 * 60 * 60 * 1000));

  // ===========================================================================
  // BARRERA 1 — `listingExpiryDays` SE APLICA DE VERDAD, y no es retroactivo
  //
  // MUTACIÓN QUE LO PONE ROJO: que `ListingExpiryService.expiresAt` vuelva a la
  // constante de 60 (o que alguien reintroduzca el estático que se eliminó).
  // ===========================================================================
  describe('BARRERA 1 — el plazo de caducidad dejó de ser decorativo', () => {
    it('un anuncio publicado DESPUÉS del cambio caduca con el valor nuevo', async () => {
      const l = await borrador();

      await withSetting(prisma, 'listingExpiryDays', 30, async () => {
        const publicado = await listings.publish(l.id, vendedorId);
        expect(publicado.expiresAt).not.toBeNull();
        expect(diasHasta(publicado.publishedAt!, publicado.expiresAt!)).toBe(30);
      });
    });

    it('NO ES RETROACTIVO: el que ya estaba publicado conserva su vencimiento', async () => {
      const l = await borrador();

      // Se publica con 30 y se guarda la fecha que le tocó.
      const antes = await withSetting(prisma, 'listingExpiryDays', 30, () =>
        listings.publish(l.id, vendedorId),
      );
      const vencimientoOriginal = antes.expiresAt!.getTime();

      // Se cambia el ajuste a 90. El anuncio vivo no se toca: su fecha está congelada
      // en la fila, y ningún cron la recalcula.
      await withSetting(prisma, 'listingExpiryDays', 90, async () => {
        const despues = await prisma.listing.findUniqueOrThrow({ where: { id: l.id } });
        expect(despues.expiresAt!.getTime()).toBe(vencimientoOriginal);
      });
    });

    it('sin fila, se aplica el defecto del código (60) — no un hueco ni un 0', async () => {
      const l = await borrador();

      await sinAjustes(prisma, ['listingExpiryDays'], async () => {
        const publicado = await listings.publish(l.id, vendedorId);
        expect(diasHasta(publicado.publishedAt!, publicado.expiresAt!)).toBe(DEFAULT_EXPIRY_DAYS);
      });
    });

    it('el backoffice ENSEÑA el mismo número que se aplica sin fila', async () => {
      await sinAjustes(prisma, ['listingExpiryDays'], async () => {
        const res = await request(app.getHttpServer())
          .get('/api/admin/settings')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        const fila = (res.body as { key: string; value: unknown; configured: boolean }[]).find(
          (s) => s.key === 'listingExpiryDays',
        );
        expect(fila).toBeDefined();
        expect(fila!.configured).toBe(false);
        expect(fila!.value).toBe(DEFAULT_EXPIRY_DAYS);
      });
    });

    it('un plazo de 0 o negativo se rechaza con 400 (el lector caería al defecto y la pantalla mentiría)', async () => {
      await patchSetting('listingExpiryDays', 0).expect(400);
      await patchSetting('listingExpiryDays', -5).expect(400);
    });
  });

  // ===========================================================================
  // BARRERA 2 — LA PERIODICIDAD FISCAL VALIDA SU ENUM
  //
  // MUTACIÓN QUE LO PONE ROJO: quitar `ENUM_SETTING_VALUES` de `updateSetting`.
  // Sin esa guarda, la basura se guarda con 200 y el lector la interpreta como
  // QUARTERLY en silencio: la pantalla diría una cosa y el cron haría otra.
  // ===========================================================================
  describe('BARRERA 2 — la periodicidad de facturación sólo admite su enum', () => {
    it('«trimestral» (basura en español) se RECHAZA con 400 y NO se guarda', async () => {
      const res = await patchSetting('fiscalInvoicingPeriodicity', 'trimestral').expect(400);
      expect(res.body.message).toContain('QUARTERLY');

      const fila = await prisma.setting.findUnique({ where: { key: 'fiscalInvoicingPeriodicity' } });
      expect(fila?.value).not.toBe('trimestral');
    });

    it('rechaza también lo que se le parece: minúsculas, dedazos y no-cadenas', async () => {
      await patchSetting('fiscalInvoicingPeriodicity', 'monthly').expect(400);
      await patchSetting('fiscalInvoicingPeriodicity', 'MONHTLY').expect(400);
      await patchSetting('fiscalInvoicingPeriodicity', 3).expect(400);
      await patchSetting('fiscalInvoicingPeriodicity', true).expect(400);
    });

    it('acepta los dos válidos, y se guardan', async () => {
      await patchSetting('fiscalInvoicingPeriodicity', 'MONTHLY').expect(200);
      expect(
        (await prisma.setting.findUniqueOrThrow({ where: { key: 'fiscalInvoicingPeriodicity' } })).value,
      ).toBe('MONTHLY');

      await patchSetting('fiscalInvoicingPeriodicity', 'QUARTERLY').expect(200);
      expect(
        (await prisma.setting.findUniqueOrThrow({ where: { key: 'fiscalInvoicingPeriodicity' } })).value,
      ).toBe('QUARTERLY');
    });
  });

  // ===========================================================================
  // BARRERA 3 — EL WHITELIST ES LA ÚNICA PUERTA
  //
  // El caso que no existía en ninguna suite: una clave que NO está en el whitelist
  // se rechaza. Cubre a la vez la BARRERA 7 (`fiscalInvoicingLastPeriod`, la marca
  // del cron de facturación, es INTOCABLE: adelantarla se salta un trimestre entero
  // de emisión en silencio).
  // ===========================================================================
  describe('BARRERA 3 y 7 — fuera del whitelist no se escribe, y el estado interno menos', () => {
    it('una clave inventada da 400 y no crea ninguna fila', async () => {
      await patchSetting('claveQueNoExiste', 1).expect(400);
      expect(await prisma.setting.findUnique({ where: { key: 'claveQueNoExiste' } })).toBeNull();
    });

    it('`fiscalInvoicingLastPeriod` —la marca del cron— NO es editable', async () => {
      const previa = await prisma.setting.findUnique({
        where: { key: 'fiscalInvoicingLastPeriod' },
      });

      const res = await patchSetting('fiscalInvoicingLastPeriod', '2020-Q1').expect(400);
      expect(res.body.message).toContain('no permitida');

      const despues = await prisma.setting.findUnique({
        where: { key: 'fiscalInvoicingLastPeriod' },
      });
      expect(despues?.value ?? null).toEqual(previa?.value ?? null);
    });

    it('`fiscalIssuer` tampoco: los datos fiscales se editan en su endpoint, con su validación', async () => {
      await patchSetting('fiscalIssuer', { taxId: 'X', fiscalName: 'Y' }).expect(400);
    });
  });

  // ===========================================================================
  // BARRERA 4 — LOS CUATRO HUÉRFANOS TIENEN CASA, GUARDA Y LECTOR
  //
  // Que estén en el whitelist no basta: cada uno tiene que llegar al backoffice con
  // el MISMO valor que su lector aplica sin fila. Un huérfano expuesto sin lector
  // sería un ajuste muerto nuevo, que es justo lo que esta ráfaga viene a cerrar.
  // ===========================================================================
  describe('BARRERA 4 — los huérfanos, con su defecto real y su guarda', () => {
    it('los cuatro salen en GET /admin/settings con el valor que se aplica sin fila', async () => {
      await sinAjustes(
        prisma,
        [
          'messageEmailGraceMinutes',
          'fiscalSelfServiceWindow',
          'fiscalInvoicingPeriodicity',
          'defaultSuspensionDays',
        ],
        async () => {
          const res = await request(app.getHttpServer())
            .get('/api/admin/settings')
            .set('Authorization', `Bearer ${adminToken}`)
            .expect(200);
          const porClave = Object.fromEntries(
            (res.body as { key: string; value: unknown }[]).map((s) => [s.key, s.value]),
          );

          // Los defectos son los de sus lectores, importados de su dueño y no copiados:
          // DEFAULT_GRACE_MINUTES (10), DEFAULT_FISCAL_WINDOW_MONTHS (6), QUARTERLY.
          expect(porClave.messageEmailGraceMinutes).toBe(10);
          expect(porClave.fiscalSelfServiceWindow).toBe(6);
          expect(porClave.fiscalInvoicingPeriodicity).toBe('QUARTERLY');
          // El suyo NO es un número: sin configurar, la suspensión es INDEFINIDA. Un 0 aquí
          // diría que hay un plazo de cero días, que no es lo que hace el botón.
          expect(porClave.defaultSuspensionDays).toBeNull();
        },
      );
    });

    it('los tres numéricos rechazan el 0 (su lector lo trataría como «sin configurar»)', async () => {
      await patchSetting('messageEmailGraceMinutes', 0).expect(400);
      await patchSetting('fiscalSelfServiceWindow', 0).expect(400);
      await patchSetting('defaultSuspensionDays', 0).expect(400);
    });

    it('y aceptan un valor legítimo, que se persiste', async () => {
      await patchSetting('messageEmailGraceMinutes', 20).expect(200);
      await patchSetting('fiscalSelfServiceWindow', 12).expect(200);
      await patchSetting('defaultSuspensionDays', 7).expect(200);

      const filas = await prisma.setting.findMany({
        where: {
          key: { in: ['messageEmailGraceMinutes', 'fiscalSelfServiceWindow', 'defaultSuspensionDays'] },
        },
      });
      expect(Object.fromEntries(filas.map((f) => [f.key, f.value]))).toEqual({
        messageEmailGraceMinutes: 20,
        fiscalSelfServiceWindow: 12,
        defaultSuspensionDays: 7,
      });
    });
  });

  // ===========================================================================
  // BARRERA 5 — `contactRequiresVerification` TIENE LECTOR
  //
  // El segundo ajuste muerto. MUTACIÓN QUE LO PONE ROJO: quitar la llamada a
  // `assertPuedeIniciarConversacion` de `startConversation`.
  // ===========================================================================
  describe('BARRERA 5 — la verificación para contactar se aplica de verdad', () => {
    let sinVerificar: string;
    let anuncioId: string;

    beforeAll(async () => {
      sinVerificar = (
        await prisma.user.create({
          data: {
            email: `ajustes-a-nover-${sufijo}@test.local`,
            name: 'Sin verificar',
            slug: `ajustes-a-nover-${sufijo}`,
            emailVerified: false,
          },
        })
      ).id;
      anuncioId = (
        await prisma.listing.create({
          data: {
            title: 'Anuncio contactable',
            slug: `ajustes-a-contact-${sufijo}`,
            description: 'descripción de prueba con longitud suficiente',
            price: 50,
            type: 'PRODUCT',
            sellerId: vendedorId,
            categoryId,
            status: 'ACTIVE',
            publishedAt: new Date(),
          },
        })
      ).id;
    });

    afterAll(async () => {
      await prisma.conversation.deleteMany({ where: { buyerId: sinVerificar } });
      await prisma.user.deleteMany({ where: { id: sinVerificar } });
    });

    const messaging = () => app.get(MessagingService);

    it('ENCENDIDO: quien no ha verificado su correo no puede abrir un hilo nuevo', async () => {
      await withSetting(prisma, 'contactRequiresVerification', true, async () => {
        await expect(
          messaging().startConversation(sinVerificar, { listingId: anuncioId, message: 'Hola' }),
        ).rejects.toThrow(ForbiddenException);

        expect(
          await prisma.conversation.count({ where: { buyerId: sinVerificar, listingId: anuncioId } }),
        ).toBe(0);
      });
    });

    it('APAGADO: el mismo usuario contacta con normalidad', async () => {
      await withSetting(prisma, 'contactRequiresVerification', false, async () => {
        const conv = await messaging().startConversation(sinVerificar, {
          listingId: anuncioId,
          message: 'Hola otra vez',
        });
        expect(conv.id).toBeTruthy();
      });
    });

    it('ENCENDIDO no cierra la puerta a un hilo que YA existía', async () => {
      // La conversación la abrió el caso anterior. Encender el ajuste no puede dejar a nadie
      // sin acceso a lo que ya tenía: la comprobación va DESPUÉS del atajo de «ya existe».
      await withSetting(prisma, 'contactRequiresVerification', true, async () => {
        const conv = await messaging().startConversation(sinVerificar, {
          listingId: anuncioId,
          message: 'sigo aquí',
        });
        expect(conv.id).toBeTruthy();
      });
    });
  });
});
