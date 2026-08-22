/**
 * PUNTO 6 · RÁFAGA A — EL MODO AVISAR: el banco de pruebas.
 *
 * Cuatro barreras, y todas afirman sobre la BASE:
 *
 *  1. **Los detectores nuevos AVISAN, no bloquean.** Un anuncio con una IP o un teléfono en
 *     el texto gana detecciones y **sigue ACTIVE**. Es la decisión entera de la ráfaga: los
 *     dos tienen falsos positivos reales —el router que documenta su `192.168.1.1`, la
 *     referencia de nueve dígitos— y no hay ni un dato sobre su frecuencia. Se mide avisando.
 *
 *  2. **El aviso vive en un eje propio y NO funde los de P1.** Detectar un teléfono no es
 *     «revisado» ni «vigilado». Se mide sobre un anuncio `REVIEWED` y no vigilado: gana la
 *     detección y sigue exactamente igual en los otros dos ejes.
 *
 *  3. **La detección corre AL EDITAR — el hueco de P1, cerrado— y es inofensiva.** Hasta
 *     ahora un ACTIVE se podía reescribir entero sin que se enterara nadie
 *     (`listing-triage.ts`). Ahora se entera el staff, y el anuncio **no se despublica**:
 *     el cambio estructural llega separado del arriesgado, que es la ráfaga B.
 *
 *  4. **Las detecciones se REEMPLAZAN ENTERAS.** Quitar el teléfono del texto las borra.
 *     Es lo que impide que una tabla persistida se pudra, y lo que hace que persistir sea
 *     preferible a derivar al vuelo como hace F1 (persistido = listable).
 *
 * Y el requisito de oro: **`WORD` sigue bloqueando** en `publish()` como siempre.
 *
 * Ver `docs/diseno-listas-bloqueo.md`.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

const BAD_WORDS = 'badWordList';

describe('Punto 6 ráfaga A — el modo avisar (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let sellerId: string;
  let sellerToken: string;
  let adminToken: string;
  let categoryId: string;
  let badWordsOriginal: unknown;

  const server = () => app.getHttpServer();

  let n = 0;
  async function crearAnuncio(
    title: string,
    description: string,
    status: 'DRAFT' | 'ACTIVE' = 'DRAFT',
  ) {
    return prisma.listing.create({
      data: {
        title,
        slug: `det-${++n}-${Date.now()}`,
        description,
        price: 10,
        type: 'PRODUCT',
        status,
        sellerId,
        categoryId,
        ...(status === 'ACTIVE' && { publishedAt: new Date() }),
      },
    });
  }

  const detecciones = (listingId: string) =>
    prisma.listingDetection.findMany({
      where: { listingId },
      orderBy: [{ detector: 'asc' }, { field: 'asc' }],
    });

  const estado = (id: string) =>
    prisma.listing.findUniqueOrThrow({
      where: { id },
      select: { status: true, triage: true, watched: true },
    });

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    // `badWordList` es dato de sistema compartido y `cleanDb` no lo limpia — molde de
    // `moderacion-previa.e2e-spec.ts`.
    badWordsOriginal =
      (await prisma.setting.findUnique({ where: { key: BAD_WORDS } }))?.value ?? null;

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [seller] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'det-seller@example.com', name: 'Det Seller', slug: 'det-seller',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'det-admin@example.com', name: 'Det Admin', slug: 'det-admin',
          passwordHash, emailVerified: true, role: 'ADMIN',
        },
      }),
    ]);
    sellerId = seller.id;

    categoryId = (
      await prisma.category.create({
        data: { name: 'Det Cat', slug: 'det-cat', attributeSchema: [] },
      })
    ).id;

    [sellerToken, adminToken] = await Promise.all([
      request(server())
        .post('/api/auth/login')
        .send({ email: 'det-seller@example.com', password: 'Test1234!' })
        .then((r) => r.body.accessToken as string),
      request(server())
        .post('/api/auth/admin-login')
        .send({ email: 'det-admin@example.com', password: 'Test1234!' })
        .then((r) => r.body.accessToken as string),
    ]);
  }, 60_000);

  afterAll(async () => {
    if (badWordsOriginal === null) {
      await prisma.setting.deleteMany({ where: { key: BAD_WORDS } });
    } else {
      await prisma.setting.upsert({
        where: { key: BAD_WORDS },
        create: { key: BAD_WORDS, value: badWordsOriginal as never },
        update: { value: badWordsOriginal as never },
      });
    }
    await app.close();
    await prisma.$disconnect();
  });

  async function fijarPalabras(palabras: string[]) {
    await prisma.setting.upsert({
      where: { key: BAD_WORDS },
      create: { key: BAD_WORDS, value: palabras as never },
      update: { value: palabras as never },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 1 — avisan, no bloquean
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 1: publicar con teléfono e IP → gana avisos y queda ACTIVE', async () => {
    await fijarPalabras([]);
    const anuncio = await crearAnuncio(
      'Router de segunda mano',
      'Se configura entrando en 192.168.1.1. Dudas al 654123456.',
    );

    await request(server())
      .post(`/api/listings/${anuncio.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    // LAS DOS MITADES EN LA MISMA PRUEBA, y hace falta que sean las dos: con sólo la
    // primera, unos detectores que además despublicaran pasarían el test.
    const filas = await detecciones(anuncio.id);
    expect(filas.map((d) => [d.detector, d.field, d.match])).toEqual([
      ['IP', 'DESCRIPTION', '192.168.1.1'],
      ['PHONE', 'DESCRIPTION', '654123456'],
    ]);
    expect((await estado(anuncio.id)).status).toBe('ACTIVE');
  });

  it('EL REQUISITO DE ORO: `WORD` sigue bloqueando en publish, como siempre', async () => {
    await fijarPalabras(['estafa']);
    const anuncio = await crearAnuncio('Vendo estafa', 'Un anuncio con palabra prohibida.');

    await request(server())
      .post(`/api/listings/${anuncio.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect((await estado(anuncio.id)).status).toBe('PENDING_REVIEW');
    // Y además deja su rastro, igual que los nuevos: BLOQUEAR es AVISAR más una consecuencia.
    expect((await detecciones(anuncio.id)).map((d) => d.detector)).toEqual(['WORD']);
    await fijarPalabras([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 2 — el eje propio, sin fundir los de P1
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 2: el aviso NO toca `triage` ni `watched` — son tres ejes, no uno', async () => {
    await fijarPalabras([]);
    const anuncio = await crearAnuncio('Bici', 'Sin nada raro todavía.', 'ACTIVE');
    // Se parte de un anuncio que un humano YA juzgó y decidió no vigilar: es el estado
    // donde un aviso que colapsara ejes haría el daño visible.
    await prisma.listing.update({
      where: { id: anuncio.id },
      data: { triage: 'REVIEWED', watched: false },
    });

    await request(server())
      .patch(`/api/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ description: 'Ahora sí: llámame al 654123456.' })
      .expect(200);

    expect((await detecciones(anuncio.id)).map((d) => d.detector)).toEqual(['PHONE']);

    const despues = await estado(anuncio.id);
    // `REVIEWED` sigue siendo `REVIEWED`: que una expresión regular encuentre un teléfono no
    // es que un humano lo haya mirado. Destruir ese juicio con un hallazgo automático es
    // exactamente lo que P1 existe para impedir.
    //
    // (Cuidado al leerlo: `triageAfterOwnerEdit` SÍ mueve REVIEWED → EDITED cuando el dueño
    // edita, y eso es de P1 y es correcto. Lo que se afirma aquí es que el aviso no añade
    // nada a ese eje ni al de vigilancia.)
    expect(despues.triage).toBe('EDITED');
    expect(despues.watched).toBe(false);
    expect(despues.status).toBe('ACTIVE');
  });

  it('y al revés: vigilar o triar un anuncio no le inventa detecciones', async () => {
    const anuncio = await crearAnuncio('Mesa', 'Nada que detectar aquí.', 'ACTIVE');

    await request(server())
      .patch(`/api/admin/listings/${anuncio.id}/triage`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ triage: 'REVIEWED', watched: true })
      .expect(200);

    expect(await detecciones(anuncio.id)).toEqual([]);
    const despues = await estado(anuncio.id);
    expect(despues.triage).toBe('REVIEWED');
    expect(despues.watched).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 3 — correr al editar: el hueco cerrado, y sin daño
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 3: editar un ACTIVE metiéndole un teléfono → gana el aviso y NO se despublica', async () => {
    await fijarPalabras([]);
    const anuncio = await crearAnuncio('Sofá', 'Un sofá normal.', 'ACTIVE');
    expect(await detecciones(anuncio.id)).toEqual([]);

    await request(server())
      .patch(`/api/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ description: 'Un sofá normal. Interesados al 654 123 456.' })
      .expect(200);

    // EL HUECO CERRADO: hasta ahora esto no producía absolutamente nada. `listing-triage.ts`
    // lo dejó escrito: «un anuncio ACTIVE se puede reescribir entero sin que se entere nadie».
    expect((await detecciones(anuncio.id)).map((d) => d.detector)).toEqual(['PHONE']);
    // Y LA MITAD QUE HACE QUE CERRARLO SEA SEGURO HOY: sigue publicado. Que editar pueda
    // despublicar es la ráfaga B, con datos delante.
    expect((await estado(anuncio.id)).status).toBe('ACTIVE');
  });

  it('editar NUNCA falla por una detección — editar es la vía de salida', async () => {
    // «Editar limpia, pero nunca frena» (`listings.service.ts`). Si editar pudiera fallar por
    // tener un teléfono, quien ya lo tuviera no podría quitarlo: la trampa perfecta.
    const anuncio = await crearAnuncio('Silla', 'Llámame al 654123456.', 'ACTIVE');
    await request(server())
      .patch(`/api/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ description: 'Llámame al 654123456 o al 912345678.' })
      .expect(200);
    expect((await detecciones(anuncio.id))).toHaveLength(2);
  });

  it('el STAFF edita: las detecciones se REFRESCAN, el `status` NO se mueve', async () => {
    // La separación del diseño §4.3, medida en las dos direcciones:
    //   · una detección es un hecho sobre el TEXTO → la refresca quien escriba el texto;
    //   · un cambio de estado es una consecuencia sobre el VENDEDOR → sólo la dispara él.
    // Si el staff no refrescara, el moderador que quita el teléfono dejaría viva la
    // detección que él mismo acaba de resolver — el flag podrido, puesto por quien vino a
    // arreglarlo.
    await fijarPalabras([]);
    const anuncio = await crearAnuncio('Lámpara', 'Contacto: 654123456.', 'ACTIVE');
    await request(server())
      .patch(`/api/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ description: 'Contacto: 654123456.' })
      .expect(200);
    expect(await detecciones(anuncio.id)).toHaveLength(1);

    await request(server())
      .patch(`/api/admin/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        description: 'Contacto por el chat de la plataforma.',
        reason: 'Se retira un teléfono del texto',
      })
      .expect(200);

    expect(await detecciones(anuncio.id)).toEqual([]);
    expect((await estado(anuncio.id)).status).toBe('ACTIVE');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 4 — reemplazo entero
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 4: re-detectar REEMPLAZA — quitar el teléfono borra su detección', async () => {
    await fijarPalabras([]);
    const anuncio = await crearAnuncio(
      'Portátil',
      'Llama al 654123456 o entra en 10.0.0.1.',
      'ACTIVE',
    );
    await request(server())
      .patch(`/api/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ description: 'Llama al 654123456 o entra en 10.0.0.1.' })
      .expect(200);
    expect((await detecciones(anuncio.id)).map((d) => d.detector)).toEqual(['IP', 'PHONE']);

    await request(server())
      .patch(`/api/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ description: 'Entra en 10.0.0.1 para verlo.' })
      .expect(200);

    // El teléfono se fue con el texto. NO se acumula: una tabla que dice que hay un teléfono
    // donde ya no lo hay le hace perder el tiempo al moderador y le enseña a desconfiar del
    // aviso — que es peor que no avisar.
    expect((await detecciones(anuncio.id)).map((d) => d.detector)).toEqual(['IP']);

    await request(server())
      .patch(`/api/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ description: 'Sin datos de contacto.' })
      .expect(200);
    expect(await detecciones(anuncio.id)).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // El banco de pruebas: verlo y listarlo
  // ───────────────────────────────────────────────────────────────────────────

  it('la ficha del anuncio sirve las detecciones con su fragmento, para poder juzgarlas', async () => {
    await fijarPalabras([]);
    const anuncio = await crearAnuncio('Router TP-Link', 'Se accede en 192.168.1.1.', 'ACTIVE');
    await request(server())
      .patch(`/api/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ description: 'Se accede en 192.168.1.1.' })
      .expect(200);

    const res = await request(server())
      .get(`/api/admin/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // El fragmento, no un booleano: una IP en un anuncio de router es legítima y en uno de
    // bicicletas no, y esa diferencia sólo se ve leyendo QUÉ se encontró. Molde de F1.
    expect(res.body.detections).toEqual([
      expect.objectContaining({ detector: 'IP', field: 'DESCRIPTION', match: '192.168.1.1' }),
    ]);
    // Y `moderationSignals` sigue existiendo, con su forma de siempre y por separado: su
    // garantía es otra (son señales de AHORA, no la causa de nada).
    expect(res.body.moderationSignals).toMatchObject({ palabraProhibida: false });
  });

  it('EL BANCO DE PRUEBAS: la lista filtra por detector — sin esto, el aviso no se lee', async () => {
    const res = await request(server())
      .get('/api/admin/listings?detector=PHONE&perPage=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const ids: string[] = res.body.items.map((l: { id: string }) => l.id);
    expect(ids.length).toBeGreaterThan(0);
    // Todos los devueltos tienen de verdad una detección de teléfono.
    const conTelefono = await prisma.listing.findMany({
      where: { id: { in: ids }, detections: { some: { detector: 'PHONE' } } },
      select: { id: true },
    });
    expect(conTelefono).toHaveLength(ids.length);

    const sinNada = await request(server())
      .get('/api/admin/listings?hasDetections=false&perPage=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const idsSinNada: string[] = sinNada.body.items.map((l: { id: string }) => l.id);
    expect(idsSinNada.some((id) => ids.includes(id))).toBe(false);
  });

  it('los dos filtros COMBINADOS no se pisan: `hasDetections=false` + `detector` da vacío', async () => {
    // Es una pregunta contradictoria y la respuesta correcta es «ninguno». Si los dos
    // filtros se escribieran como dos campos sueltos sobre la misma relación, el segundo
    // pisaría al primero SIN ERROR y esto devolvería «los que tienen teléfono» — la
    // respuesta contraria a la pregunta.
    const res = await request(server())
      .get('/api/admin/listings?hasDetections=false&detector=PHONE&perPage=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.items).toEqual([]);
  });
});
