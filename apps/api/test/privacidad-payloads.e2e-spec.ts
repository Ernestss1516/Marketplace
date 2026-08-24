/**
 * EL BARRIDO DE PRIVACIDAD — qué campos de un anuncio pueden salir por CADA puerta.
 *
 * POR QUÉ ESTE FICHERO EXISTE, y por qué es uno solo.
 *
 * Dos fugas seguidas, la misma causa: un `include` de Prisma sin `select` devuelve la fila
 * ENTERA, y la defensa era en los dos casos «quitar a mano el campo que nos acordamos».
 *
 *   1. `GET /favorites` servía `phone` —el teléfono publicado— a cualquiera que marcase el
 *      anuncio, esquivando el rate limit de `GET /listings/:id/phone`.
 *   2. `GET /listings/:slug` —la ficha PÚBLICA, sin sesión— quitaba `phone` y servía
 *      `phoneNormalized`, que es el MISMO número por la columna hermana. Y con él
 *      `lastOwnerIp`, la IP del vendedor.
 *
 * La segunda vivió meses porque el barrido que existía sólo miraba UNA puerta. Así que este
 * fichero no comprueba una ruta: comprueba **la matriz entera** de superficies × campos
 * prohibidos. Cuando aparezca una superficie nueva que sirva anuncios, su sitio es esta
 * tabla — y si no se añade, al menos el requisito de oro del final la echará en falta.
 *
 * LAS ASERCIONES VAN POR PARTIDA DOBLE, y las dos hacen falta:
 *   · por NOMBRE (`campo in payload`) — caza un `include` crudo que vuelva con el campo a
 *     null, que por valor no se notaría;
 *   · por VALOR (el número, la IP) en el JSON completo — caza que el dato se cuele por un
 *     campo nuevo con otro nombre.
 *
 * Ver docs/auditoria-pro-video.md: «Hallazgo colateral» y «Hallazgo NUEVO y MÁS GRAVE».
 */
import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

/** El teléfono y la IP del vendedor, con valores reconocibles a simple vista en un JSON. */
const TELEFONO = '600123456';
const IP_DEL_VENDEDOR = '198.51.100.7';

/**
 * Lo que NUNCA sale por ninguna puerta, ni siquiera a su dueño.
 *
 * `phone` NO está en esta lista y `phoneNormalized` SÍ, y la asimetría es el corazón del
 * arreglo: el dueño puede ver su propio teléfono porque el editor lo edita, pero
 * `phoneNormalized` es una copia derivada que nadie edita ni muestra — y era justo la que
 * derrotaba la protección de la ficha pública.
 */
const PROHIBIDOS_SIEMPRE = [
  'phoneNormalized',
  'lastOwnerIp',
  'lastOwnerInteractionAt',
  'triage',
  'watched',
] as const;

/** Lo que además no sale en PÚBLICO: el teléfono y el aviso de gestión del dueño. */
const PROHIBIDOS_EN_PUBLICO = [...PROHIBIDOS_SIEMPRE, 'phone', 'needsRevalidation'] as const;

describe('Privacidad de los payloads de anuncio (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let sellerId: string;
  let sellerToken: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } })).id;
    const seller = await prisma.user.create({
      data: {
        email: 'privacidad@example.com',
        name: 'Vendedor',
        slug: 'privacidad-vendedor',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    sellerId = seller.id;
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'privacidad@example.com', password: 'Test1234!' });
    sellerToken = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /**
   * Un anuncio con TODOS los campos sensibles rellenos. Si alguno se dejara a null, su
   * ausencia en el payload no probaría nada — el test mediría el fixture, no el arreglo.
   */
  async function crearAnuncio(sufijo: string, extra: Prisma.ListingUncheckedCreateInput | object = {}) {
    return prisma.listing.create({
      data: {
        title: `Anuncio ${sufijo}`,
        slug: `privacidad-${sufijo}`,
        description: 'Descripción del anuncio de prueba',
        price: new Prisma.Decimal('250.00'),
        currency: 'EUR',
        type: 'PRODUCT',
        priceType: 'FIXED',
        priceUnit: 'PER_MONTH',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        sellerId,
        categoryId,
        publishedAt: new Date(),
        city: 'Valencia',
        province: 'Valencia',
        // Los cinco sensibles, todos con valor.
        phone: TELEFONO,
        phoneNormalized: TELEFONO,
        lastOwnerIp: IP_DEL_VENDEDOR,
        lastOwnerInteractionAt: new Date(),
        watched: true,
        ...extra,
      },
      select: { id: true, slug: true },
    });
  }

  /** Ni el número ni la IP en NINGÚN punto del JSON, se llame como se llame el campo. */
  function sinDatosSensiblesEnBruto(body: unknown) {
    const json = JSON.stringify(body);
    expect(json).not.toContain(TELEFONO);
    expect(json).not.toContain(IP_DEL_VENDEDOR);
  }

  // ── 1. La ficha PÚBLICA: la puerta más expuesta ────────────────────────────

  describe('GET /listings/:slug — sin sesión', () => {
    it('BARRERA 1 — el teléfono no sale por NINGUNA columna, ni `phone` ni `phoneNormalized`', async () => {
      const anuncio = await crearAnuncio('ficha-telefono');

      const res = await request(app.getHttpServer())
        .get(`/api/listings/${anuncio.slug}`)
        .expect(200);

      expect(res.body.phone).toBeUndefined();
      // LA FUGA EXACTA: `phone` se descartaba y esta columna —el mismo número sin prefijo
      // ni separadores— salía intacta. Filtrar una y no la otra no protegía nada.
      expect(res.body.phoneNormalized).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(TELEFONO);

      // Y lo que SÍ debe salir en su lugar: el booleano que pinta el botón "Ver teléfono".
      expect(res.body.hasPhone).toBe(true);
    });

    it('BARRERA 2 — la IP del vendedor no sale', async () => {
      const anuncio = await crearAnuncio('ficha-ip');

      const res = await request(app.getHttpServer())
        .get(`/api/listings/${anuncio.slug}`)
        .expect(200);

      expect(res.body.lastOwnerIp).toBeUndefined();
      expect(res.body.lastOwnerInteractionAt).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(IP_DEL_VENDEDOR);
    });

    it('BARRERA 3 — las etiquetas internas de moderación no salen', async () => {
      const anuncio = await crearAnuncio('ficha-moderacion');

      const res = await request(app.getHttpServer())
        .get(`/api/listings/${anuncio.slug}`)
        .expect(200);

      // `triage` y `watched` son notas del equipo. Que las viera cualquiera —incluido el
      // denunciado— era el agravante del hallazgo.
      expect(res.body.triage).toBeUndefined();
      expect(res.body.watched).toBeUndefined();
      expect(res.body.needsRevalidation).toBeUndefined();
    });

    it('BARRERA 4 — LISTA BLANCA: el payload trae SÓLO los campos públicos enumerados', async () => {
      const anuncio = await crearAnuncio('ficha-lista-blanca');

      const res = await request(app.getHttpServer())
        .get(`/api/listings/${anuncio.slug}`)
        .expect(200);

      // La garantía por construcción, dicha al revés: no se comprueba que falten cinco
      // campos conocidos, sino que NO SOBRA NINGUNO. Un campo sensible nuevo en `Listing`
      // hace fallar este test sin que nadie tenga que acordarse de añadirlo arriba — que es
      // exactamente lo que no ocurrió con `phoneNormalized`.
      const PERMITIDOS = new Set([
        'id', 'title', 'slug', 'description', 'price', 'currency', 'priceType', 'priceUnit',
        'type', 'condition', 'status', 'attributes', 'city', 'province', 'postalCode',
        'latitude', 'longitude', 'publishedAt', 'viewCount', 'bumpedAt', 'videoUrl',
        'videoPosterUrl', 'images', 'category', 'seller', 'tags',
        // Derivados que añade `findBySlug` fuera del blob cacheado.
        'hasPhone', 'featuredUntil', 'nextBumpAt',
      ]);
      const sobrantes = Object.keys(res.body).filter((k) => !PERMITIDOS.has(k));
      expect(sobrantes).toEqual([]);
    });

    it('BARRERA 5 — la ficha sigue COMPLETA: el arreglo no le quita nada legítimo', async () => {
      const anuncio = await crearAnuncio('ficha-completa', {
        videoUrl: `${process.env.S3_PUBLIC_URL}/listing-videos/x/v.mp4`,
        videoPosterUrl: `${process.env.S3_PUBLIC_URL}/uploads/p.jpg`,
        attributes: { marca: 'Acme' },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/listings/${anuncio.slug}`)
        .expect(200);

      // Todo lo que la ficha pinta. Si estrechar el `select` se hubiera pasado de frenada,
      // el fallo se ve aquí y no en producción.
      expect(res.body.title).toBe('Anuncio ficha-completa');
      expect(res.body.description).toBeTruthy();
      expect(res.body.price).toBeDefined();
      // RP.4b — el sufijo del precio. Es el campo que más fácil se pierde al pasar de un
      // `include` (que lo traía gratis) a una lista blanca (que hay que acordarse de poner).
      expect(res.body.priceUnit).toBe('PER_MONTH');
      expect(res.body.condition).toBe('GOOD');
      expect(res.body.city).toBe('Valencia');
      expect(res.body.attributes).toEqual({ marca: 'Acme' });
      expect(res.body.viewCount).toBeDefined();
      expect(res.body.publishedAt).toBeTruthy();
      // Vídeo Pro — en la FICHA sí viaja la dirección: es donde el vídeo se ve.
      expect(res.body.videoUrl).toContain('listing-videos/');
      expect(res.body.videoPosterUrl).toBeTruthy();
      // Las relaciones que la ficha necesita.
      expect(res.body.category.slug).toBe('moviles');
      expect(res.body.category.name).toBeTruthy();
      expect(res.body.seller.slug).toBe('privacidad-vendedor');
      expect(res.body.seller.ratingCount).toBeDefined();
      expect(Array.isArray(res.body.tags)).toBe(true);
      expect(Array.isArray(res.body.images)).toBe(true);
    });

    it('BARRERA 6 — la CACHÉ tampoco puede servir los campos viejos', async () => {
      const anuncio = await crearAnuncio('ficha-cache');

      // Primera visita: llena la caché de Redis. Lo que se guarda es el resultado de la
      // proyección, no la fila — así que el blob no puede contener lo que no se emite.
      await request(app.getHttpServer()).get(`/api/listings/${anuncio.slug}`).expect(200);

      // Segunda visita: servida DESDE la caché. Es el camino que dejaba viva la fuga
      // durante los 5 minutos del TTL después de desplegar el arreglo.
      const res = await request(app.getHttpServer())
        .get(`/api/listings/${anuncio.slug}`)
        .expect(200);

      for (const campo of PROHIBIDOS_EN_PUBLICO) {
        expect(res.body[campo]).toBeUndefined();
      }
      sinDatosSensiblesEnBruto(res.body);
      // Y sigue completa viniendo de caché.
      expect(res.body.hasPhone).toBe(true);
      expect(res.body.priceUnit).toBe('PER_MONTH');
    });

    it('BARRERA 6b — un blob VIEJO ya guardado en Redis se purga al arrancar', async () => {
      // EL CASO QUE NINGÚN OTRO TEST CUBRE. Los dos anteriores comprueban que lo que se
      // ESCRIBE en la caché es seguro. Éste comprueba lo otro: qué pasa con lo que ya
      // estaba escrito ANTES del despliegue, que es la fuga sobreviviendo al arreglo.
      const anuncio = await crearAnuncio('ficha-blob-viejo');
      const clave = `listing:${anuncio.slug}`;

      // Se falsifica a mano un blob con la forma ANTIGUA — la que servía el `include`
      // crudo, con los cinco campos dentro.
      const blobViejo = {
        id: anuncio.id,
        slug: anuncio.slug,
        title: 'Anuncio ficha-blob-viejo',
        status: 'ACTIVE',
        hasPhone: true,
        phoneNormalized: TELEFONO,
        lastOwnerIp: IP_DEL_VENDEDOR,
        triage: 'NEW',
        watched: true,
        seller: { id: sellerId, slug: 'privacidad-vendedor' },
      };
      const redis = new (await import('ioredis')).default(process.env.REDIS_URL!);
      try {
        await redis.setex(clave, 300, JSON.stringify(blobViejo));
        expect(await redis.get(clave)).toContain(IP_DEL_VENDEDOR);

        // Arrancar la aplicación dispara `ListingsService.onModuleInit`, que purga
        // `listing:*`. Es lo que convierte «hay que acordarse de purgar al desplegar» en
        // algo que ocurre solo.
        const otraApp = await createTestApp();
        await otraApp.init();
        try {
          expect(await redis.get(clave)).toBeNull();

          // Y la siguiente visita repuebla la caché con la forma nueva.
          const res = await request(otraApp.getHttpServer())
            .get(`/api/listings/${anuncio.slug}`)
            .expect(200);
          sinDatosSensiblesEnBruto(res.body);
        } finally {
          await otraApp.close();
        }
      } finally {
        await redis.quit();
      }
    });
  });

  // ── 2. Las puertas del DUEÑO: su teléfono sí, la moderación no ─────────────
  //
  // Aquí la fuga era menos grave —hay que ser el dueño— pero no inocua: `triage` y
  // `watched` son notas del EQUIPO sobre este anuncio, y quien las veía era justamente la
  // persona sobre la que se han tomado.

  describe('las puertas del DUEÑO', () => {
    /** Comprueba las dos mitades: lo suyo llega, lo del equipo no. */
    function esRespuestaDeDueno(body: Record<string, unknown>) {
      for (const campo of PROHIBIDOS_SIEMPRE) {
        expect(body[campo]).toBeUndefined();
      }
      expect(JSON.stringify(body)).not.toContain(IP_DEL_VENDEDOR);
      // Su teléfono SÍ: el editor lo edita, y esconderlo lo borraría al guardar.
      expect(body.phone).toBe(TELEFONO);
    }

    it('GET /listings/mine/:id — el editor recibe su teléfono, no las notas del equipo', async () => {
      const anuncio = await crearAnuncio('dueno-editor');

      const res = await request(app.getHttpServer())
        .get(`/api/listings/mine/${anuncio.id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      esRespuestaDeDueno(res.body);
      // El wizard de edición necesita esto para repintarse.
      expect(res.body.title).toBeTruthy();
      expect(res.body.priceUnit).toBe('PER_MONTH');
      expect(res.body.category.id).toBeTruthy();
      expect(Array.isArray(res.body.images)).toBe(true);
      expect(Array.isArray(res.body.tags)).toBe(true);
    });

    it('PATCH /listings/:id — la respuesta de editar tampoco las lleva', async () => {
      const anuncio = await crearAnuncio('dueno-patch');

      const res = await request(app.getHttpServer())
        .patch(`/api/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ title: 'Título editado' })
        .expect(200);

      esRespuestaDeDueno(res.body);
      expect(res.body.title).toBe('Título editado');
    });

    it('las acciones del ciclo de vida devuelven todas la forma saneada', async () => {
      // Las cuatro pasan por el MISMO envoltorio del controlador (`gestionDeAnuncio`), así
      // que este test comprueba que el envoltorio está puesto en las cuatro — no cuatro
      // implementaciones distintas.
      for (const accion of ['reserve', 'pause', 'archive'] as const) {
        const anuncio = await crearAnuncio(`dueno-${accion}`);
        const res = await request(app.getHttpServer())
          .post(`/api/listings/${anuncio.id}/${accion}`)
          .set('Authorization', `Bearer ${sellerToken}`)
          .expect(200);
        esRespuestaDeDueno(res.body);
        expect(res.body.status).toBeTruthy();
      }

      // `reactivate` necesita salir de PAUSED, así que va aparte. Y antes hay que hacerle
      // sitio: este vendedor ya acumula los anuncios de los tests anteriores y volver a
      // ACTIVE pasa por la cuota de activos (403 si está llena) — un tope de plan, nada que
      // ver con la privacidad, pero tumbaría el test igual.
      await prisma.listing.updateMany({
        where: { sellerId, status: ListingStatus.ACTIVE },
        data: { status: ListingStatus.ARCHIVED },
      });
      const pausado = await crearAnuncio('dueno-reactivate', { status: ListingStatus.PAUSED });
      const reactivado = await request(app.getHttpServer())
        .post(`/api/listings/${pausado.id}/reactivate`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      esRespuestaDeDueno(reactivado.body);
      expect(reactivado.body.status).toBe('ACTIVE');
    });

    it('POST /listings/:id/deals — la forma {listing, deal} también se sanea, y el deal sobrevive', async () => {
      const anuncio = await crearAnuncio('dueno-deal');

      // Cuerpo vacío = «vendido sin comprador registrado», el fallback que admite un
      // PRODUCT sin contactos (ver CloseDealDto).
      const res = await request(app.getHttpServer())
        .post(`/api/listings/${anuncio.id}/deals`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({})
        .expect(201);

      // El anuncio anidado va saneado…
      esRespuestaDeDueno(res.body.listing);
      expect(res.body.listing.status).toBe('SOLD');
      // …y la envoltura NO se pierde por el camino: proyectar el anuncio no puede comerse
      // el resto de la respuesta (el error que habría cometido un saneado indiscriminado).
      expect('deal' in res.body).toBe(true);
    });

    it('POST /listings/:id/bump — la respuesta que NO es un anuncio no se toca', async () => {
      // El contraejemplo que justifica que haya DOS envoltorios en el controlador: `bump`
      // devuelve {bumpedAt, paidWith, cost}. Sanearlo con las claves de un anuncio le
      // habría comido `paidWith` y `cost` en silencio.
      const anuncio = await crearAnuncio('dueno-bump');
      await prisma.wallet.upsert({
        where: { userId: sellerId },
        create: { userId: sellerId, balance: 500 },
        update: { balance: 500 },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/listings/${anuncio.id}/bump`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      expect(res.body.bumpedAt).toBeTruthy();
      expect(res.body.paidWith).toBeTruthy();
      expect(res.body.cost).toBeDefined();
    });
  });

  // ── 3. Requisito de oro ────────────────────────────────────────────────────

  it('REQUISITO DE ORO — ninguna superficie de anuncio filtra el teléfono ni la IP', async () => {
    // El barrido completo, superficie por superficie. Si mañana aparece una puerta nueva
    // que sirva anuncios, su sitio es esta lista.
    const anuncio = await crearAnuncio('oro');
    await request(app.getHttpServer())
      .post(`/api/favorites/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    const conSesion = { Authorization: `Bearer ${sellerToken}` };
    const superficies: { nombre: string; res: request.Response }[] = [
      {
        nombre: 'GET /listings/:slug (público)',
        res: await request(app.getHttpServer()).get(`/api/listings/${anuncio.slug}`),
      },
      {
        nombre: 'GET /listings (portada)',
        res: await request(app.getHttpServer()).get('/api/listings'),
      },
      {
        nombre: 'GET /listings/mine/:id',
        res: await request(app.getHttpServer()).get(`/api/listings/mine/${anuncio.id}`).set(conSesion),
      },
      {
        nombre: 'GET /users/me/listings',
        res: await request(app.getHttpServer()).get('/api/users/me/listings').set(conSesion),
      },
      {
        nombre: 'GET /favorites',
        res: await request(app.getHttpServer()).get('/api/favorites').set(conSesion),
      },
      {
        nombre: 'GET /users/:slug/listings',
        res: await request(app.getHttpServer()).get('/api/users/privacidad-vendedor/listings'),
      },
    ];

    for (const { nombre, res } of superficies) {
      expect([nombre, res.status]).toEqual([nombre, 200]);
      // La IP NUNCA, en ninguna. El teléfono tampoco en bruto salvo donde el dueño edita
      // su propio anuncio (`/listings/mine/:id`), que es la única excepción justificada.
      expect([nombre, JSON.stringify(res.body).includes(IP_DEL_VENDEDOR)]).toEqual([nombre, false]);
      const puedeVerSuTelefono = nombre === 'GET /listings/mine/:id';
      expect([nombre, JSON.stringify(res.body).includes(TELEFONO)]).toEqual([
        nombre,
        puedeVerSuTelefono,
      ]);
    }
  });
});
