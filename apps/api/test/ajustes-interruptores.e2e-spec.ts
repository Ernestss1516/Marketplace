/**
 * LOS INTERRUPTORES QUE EXISTÍAN SIN POSIBILIDAD DE PULSARLOS.
 *
 * EL DEFECTO. Cuatro ajustes —`videoEnabled`, `attributeRevalidationEnabled`,
 * `bumpAutoEnabled` y `maxBumpSchedulesPerUser`— estaban en el whitelist del backend, así
 * que `GET`/`PATCH /admin/settings` los manejaban perfectamente. Pero:
 *
 *   · la semilla de producción no creaba tres de ellos,
 *   · `SETTING_DEFAULTS` no conocía ninguno, así que `GET /admin/settings` los devolvía con
 *     `value: null`,
 *   · y la página de ajustes recorre un array escrito a mano donde no estaban.
 *
 * Para el vídeo eso significaba que la feature ENTERA —construida, probada y documentada—
 * era inalcanzable: `assertEnabled` rechazaba toda subida y el editor ni pintaba la sección,
 * porque no había forma de encenderla. El circuito estaba completo salvo el interruptor.
 *
 * Y `bumpAutoEnabled` era peor que invisible: sin fila está ENCENDIDO, así que el `null` lo
 * habría pintado apagado mientras el cron bumpeaba de verdad. Un ajuste que miente sobre lo
 * que está pasando es peor que uno que no se ve.
 *
 * Ver docs/auditoria-pro-video.md §2.0.
 */
import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { preservarAjustes, sinAjustes } from './helpers/settings';
import { SEED_SETTINGS } from '../prisma/seed-settings';

/** Los cuatro, con el valor que se aplica DE VERDAD cuando no hay fila. */
const INTERRUPTORES: { clave: string; sinFila: unknown }[] = [
  { clave: 'videoEnabled', sinFila: false },
  { clave: 'attributeRevalidationEnabled', sinFila: false },
  // El único que NO nace apagado — y justo el que el `null` pintaba al revés.
  { clave: 'bumpAutoEnabled', sinFila: true },
  { clave: 'maxBumpSchedulesPerUser', sinFila: 10 },
];

describe('Ajustes — los cuatro interruptores conmutables desde el backoffice (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let sellerToken: string;
  let listingId: string;

  // LA RED DEBAJO — esta suite es la que peor trataba a `Setting`, y no por poco.
  //
  // Su objeto de estudio SON estos cuatro ajustes: los borra (BARRERA 1b), los
  // enciende y los apaga por la vía real... y su `afterAll` sólo cerraba la app. Al
  // terminar dejaba `videoEnabled` en `false` —la última escritura de la suite es
  // `ponerVideo(false)`— cuando `seed-test.ts` lo siembra en `true` a propósito,
  // «para que las baterías puedan ejercitar la feature». Y ahí la ausencia y el
  // valor NO son equivalentes: sin fila el vídeo está APAGADO. Toda suite que
  // corriera después con el vídeo encendido por supuesto se lo encontraba apagado.
  //
  // Hoy no rompía a nadie —las cuatro suites que dependen del interruptor lo fijan
  // ellas mismas—, así que era una mina sin pisar, no un rojo. Pero es la prueba
  // más limpia de por qué la regla es RESTAURAR y no BORRAR: en
  // `freeActiveListingLimit` el defecto quedaba tapado por la casualidad de que el
  // valor por defecto del código coincide con el del seed; aquí no habría nada que
  // lo tapara.
  preservarAjustes(INTERRUPTORES.map((i) => i.clave));

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } })).id;

    await prisma.user.create({
      data: {
        email: 'ajustes-admin@example.com',
        name: 'Admin',
        slug: 'ajustes-admin',
        role: 'ADMIN',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    // El staff entra por su propia puerta (`admin-login`), no por la de los usuarios.
    adminToken = (
      await request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'ajustes-admin@example.com', password: 'Test1234!' })
    ).body.accessToken;

    // Un vendedor PRO: el gate del vídeo comprueba primero la feature y después el plan, así
    // que sin Pro el test mediría el gate equivocado.
    const seller = await prisma.user.create({
      data: {
        email: 'ajustes-pro@example.com',
        name: 'Pro',
        slug: 'ajustes-pro',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    await prisma.entitlement.create({
      data: {
        userId: seller.id,
        type: 'PRO_SUBSCRIPTION',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    sellerToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'ajustes-pro@example.com', password: 'Test1234!' })
    ).body.accessToken;

    listingId = (
      await prisma.listing.create({
        data: {
          title: 'Anuncio con vídeo',
          slug: 'ajustes-anuncio-video',
          description: 'Para probar el interruptor del vídeo',
          price: new Prisma.Decimal('100.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: ListingStatus.ACTIVE,
          sellerId: seller.id,
          categoryId,
          publishedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function leerAjustes() {
    const res = await request(app.getHttpServer())
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return res.body as { key: string; value: unknown; configured: boolean }[];
  }

  function ponerVideo(valor: boolean) {
    return request(app.getHttpServer())
      .patch('/api/admin/settings/videoEnabled')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: valor })
      .expect(200);
  }

  // ── BARRERA 1 — existen y se pueden pintar ─────────────────────────────────

  it('BARRERA 1 — los cuatro salen en GET /admin/settings, que es de donde el backoffice los pinta', async () => {
    const ajustes = await leerAjustes();
    const claves = new Set(ajustes.map((a) => a.key));

    for (const { clave } of INTERRUPTORES) {
      expect([clave, claves.has(clave)]).toEqual([clave, true]);
    }
  });

  it('BARRERA 1b — y sin fila valen lo que se aplica DE VERDAD, no null', async () => {
    // El defecto que este test fija: las cuatro claves estaban en el whitelist pero no en
    // SETTING_DEFAULTS, así que salían a `null`. Para tres daba «apagado» por casualidad;
    // para `bumpAutoEnabled` —encendido sin fila— el backoffice habría mentido.
    //
    // El borrado va acotado a este caso: era un `deleteMany` suelto en el cuerpo, y las
    // cuatro claves se quedaban sin fila para todo lo que viniera detrás.
    await sinAjustes(prisma, INTERRUPTORES.map((i) => i.clave), async () => {
      const ajustes = await leerAjustes();
      for (const { clave, sinFila } of INTERRUPTORES) {
        const fila = ajustes.find((a) => a.key === clave)!;
        expect([clave, fila.configured]).toEqual([clave, false]);
        expect([clave, fila.value]).toEqual([clave, sinFila]);
      }
    });
  });

  // ── BARRERA 2 — se puede encender y apagar, y el circuito responde ─────────

  describe('BARRERA 2 — el interruptor del vídeo mueve la feature entera', () => {
    /** Lo que el vendedor Pro necesita para subir: la firma. Es donde vive `assertEnabled`. */
    function pedirFirma() {
      return request(app.getHttpServer())
        .post('/api/video/upload-url')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          listingId,
          contentType: 'video/mp4',
          sizeBytes: 1024 * 1024,
          durationSeconds: 20,
        });
    }

    it('APAGADO: la configuración dice enabled=false y el servidor rechaza con VIDEO_DISABLED', async () => {
      await ponerVideo(false);

      const config = await request(app.getHttpServer())
        .get('/api/video/config')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      expect(config.body.enabled).toBe(false);

      const firma = await pedirFirma().expect(400);
      expect(firma.body.code).toBe('VIDEO_DISABLED');
    });

    it('ENCENDIDO desde el backoffice: la configuración dice enabled=true y la firma pasa', async () => {
      await ponerVideo(true);

      // `GET /video/config` es lo que lee el editor para decidir si la sección existe
      // (resolveEditSections). Encenderlo aquí es lo que la hace aparecer.
      const config = await request(app.getHttpServer())
        .get('/api/video/config')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      expect(config.body.enabled).toBe(true);
      expect(config.body.maxDurationSeconds).toBe(60);

      // Y el guard deja pasar: se emite un permiso de subida de verdad.
      const firma = await pedirFirma().expect(201);
      expect(firma.body.uploadUrl).toContain('http');
      expect(firma.body.key).toContain('listing-videos/');
    });

    it('y volver a apagarlo lo cierra otra vez: el apagado sigue funcionando', async () => {
      // Encender no es un viaje de ida. Lo que cambia con este arreglo no es la política
      // —el vídeo sigue naciendo apagado— sino que ahora el interruptor se ve y se pulsa.
      await ponerVideo(false);
      const firma = await pedirFirma().expect(400);
      expect(firma.body.code).toBe('VIDEO_DISABLED');
    });
  });

  // ── BARRERA 3 — nace apagado ───────────────────────────────────────────────

  describe('BARRERA 3 — la semilla los crea, y el vídeo nace APAGADO', () => {
    it('la semilla de producción declara los cuatro interruptores', async () => {
      const claves = new Set(SEED_SETTINGS.map((s) => s.key));
      for (const { clave } of INTERRUPTORES) {
        expect([clave, claves.has(clave)]).toEqual([clave, true]);
      }
    });

    it('`videoEnabled` se siembra en FALSE — encenderlo tiene que ser un acto explícito', () => {
      // LA DECISIÓN, fijada donde no se puede deshacer por descuido: la feature cuesta
      // almacenamiento y ancho de banda desde el primer vídeo, así que la semilla crea el
      // interruptor pero NO lo pulsa. Si alguien cambiara esto a `true`, el vídeo quedaría
      // encendido en producción sin que nadie lo hubiera decidido.
      const fila = SEED_SETTINGS.find((s) => s.key === 'videoEnabled');
      expect(fila).toBeDefined();
      expect(fila!.value).toBe(false);
    });

    it('y ningún valor sembrado contradice al que se aplica sin fila', () => {
      // Los dos sitios dicen lo mismo, y este test es lo que impide que se separen: si la
      // semilla creara `bumpAutoEnabled: false` mientras el servicio lo trata como
      // encendido sin fila, un entorno sembrado y otro sin sembrar se comportarían distinto.
      for (const { clave, sinFila } of INTERRUPTORES) {
        const fila = SEED_SETTINGS.find((s) => s.key === clave);
        expect([clave, fila?.value]).toEqual([clave, sinFila]);
      }
    });
  });
});
