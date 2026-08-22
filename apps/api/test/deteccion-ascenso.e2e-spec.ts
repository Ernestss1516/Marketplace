/**
 * PUNTO 6 · RÁFAGA B — EL ASCENSO: de avisar a bloquear.
 *
 * Cuatro barreras, y la segunda es la que decide si esta ráfaga vale algo:
 *
 *  1. **`BLOCK` es efectivo.** Con `PHONE` ascendido, publicar con un teléfono en el texto
 *     va a `PENDING_REVIEW`. Con `PHONE` en avisar —lo de nacimiento—, sólo avisa.
 *
 *  2. **LA PUERTA DE SALIDA.** Un anuncio bloqueado por una detección **sale editando**:
 *     el vendedor quita el teléfono y vuelve al escaparate. Sin esto, bloquear es una
 *     TRAMPA — `publish()` sólo admite DRAFT y de `PENDING_REVIEW` sólo sacaba un moderador,
 *     así que cada falso positivo se convertiría en una espera indefinida por algo que el
 *     vendedor puede arreglar solo. **Se mide el ciclo COMPLETO**: bloquea → edita → sale.
 *
 *  3. **Ascender es cambiar un VALOR**, no un camino de código. El mismo anuncio y el mismo
 *     detector, con el ajuste puesto de una forma y de la otra.
 *
 *  4. **El contador es honesto**: recuentos en bruto, sin ninguna tasa que no se puede medir.
 *
 * Y el requisito de oro: **`WORD` no cambia**, avisar sigue avisando, el staff editando
 * sigue sin mover el estado, y P1 sigue intacto.
 *
 * Ver `docs/diseno-listas-bloqueo.md` §2.4 y §4.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

const MODES = 'detectionModes';
const BAD_WORDS = 'badWordList';
const TELEFONO = 'Interesados al 654123456.';

describe('Punto 6 ráfaga B — el ascenso (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let sellerId: string;
  let sellerToken: string;
  let adminToken: string;
  let categoryId: string;
  let modosOriginal: unknown;
  let badWordsOriginal: unknown;

  const server = () => app.getHttpServer();

  let n = 0;
  async function crearAnuncio(
    description: string,
    status: 'DRAFT' | 'ACTIVE' = 'DRAFT',
  ) {
    return prisma.listing.create({
      data: {
        title: `Asc ${++n}`,
        slug: `asc-${n}-${Date.now()}`,
        description,
        price: 10,
        type: 'PRODUCT',
        status,
        sellerId,
        categoryId,
        ...(status === 'ACTIVE' && {
          publishedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        }),
      },
    });
  }

  const estado = (id: string) =>
    prisma.listing.findUniqueOrThrow({
      where: { id },
      select: { status: true, triage: true, watched: true, expiresAt: true },
    });

  const editar = (id: string, description: string) =>
    request(server())
      .patch(`/api/listings/${id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ description });

  async function fijarModos(modos: unknown) {
    await prisma.setting.upsert({
      where: { key: MODES },
      create: { key: MODES, value: modos as never },
      update: { value: modos as never },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    // Ajustes de sistema: `cleanDb` no los limpia, así que se restauran al final.
    modosOriginal = (await prisma.setting.findUnique({ where: { key: MODES } }))?.value ?? null;
    badWordsOriginal =
      (await prisma.setting.findUnique({ where: { key: BAD_WORDS } }))?.value ?? null;
    await prisma.setting.upsert({
      where: { key: BAD_WORDS },
      create: { key: BAD_WORDS, value: [] as never },
      update: { value: [] as never },
    });

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [seller] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'asc-seller@example.com', name: 'Asc Seller', slug: 'asc-seller',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'asc-admin@example.com', name: 'Asc Admin', slug: 'asc-admin',
          passwordHash, emailVerified: true, role: 'ADMIN',
        },
      }),
    ]);
    sellerId = seller.id;

    categoryId = (
      await prisma.category.create({
        data: { name: 'Asc Cat', slug: 'asc-cat', attributeSchema: [] },
      })
    ).id;

    [sellerToken, adminToken] = await Promise.all([
      request(server())
        .post('/api/auth/login')
        .send({ email: 'asc-seller@example.com', password: 'Test1234!' })
        .then((r) => r.body.accessToken as string),
      request(server())
        .post('/api/auth/admin-login')
        .send({ email: 'asc-admin@example.com', password: 'Test1234!' })
        .then((r) => r.body.accessToken as string),
    ]);
  }, 60_000);

  afterAll(async () => {
    for (const [key, valor] of [
      [MODES, modosOriginal],
      [BAD_WORDS, badWordsOriginal],
    ] as const) {
      if (valor === null) {
        await prisma.setting.deleteMany({ where: { key } });
      } else {
        await prisma.setting.upsert({
          where: { key },
          create: { key, value: valor as never },
          update: { value: valor as never },
        });
      }
    }
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 1 — BLOCK efectivo
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 1: con PHONE ascendido, publicar con teléfono → PENDING_REVIEW', async () => {
    await fijarModos({ PHONE: 'BLOCK' });
    const anuncio = await crearAnuncio(`Una bici en buen estado. ${TELEFONO}`);

    await request(server())
      .post(`/api/listings/${anuncio.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect((await estado(anuncio.id)).status).toBe('PENDING_REVIEW');
    // Y deja su rastro igual que avisando: bloquear es avisar MÁS una consecuencia.
    expect(
      await prisma.listingDetection.count({
        where: { listingId: anuncio.id, detector: 'PHONE' },
      }),
    ).toBe(1);
  });

  it('y sin ascender (lo de nacimiento) sólo avisa — la ráfaga A sigue en pie', async () => {
    await fijarModos({});
    const anuncio = await crearAnuncio(`Una mesa. ${TELEFONO}`);

    await request(server())
      .post(`/api/listings/${anuncio.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect((await estado(anuncio.id)).status).toBe('ACTIVE');
    expect(await prisma.listingDetection.count({ where: { listingId: anuncio.id } })).toBe(1);
  });

  it('EL CAMBIO DE CICLO DE VIDA: editar un ACTIVE metiéndole un teléfono lo devuelve a la cola', async () => {
    // ESTO ES NUEVO PARA EL VENDEDOR y es lo que esta ráfaga añade de verdad: hasta ahora
    // editar un anuncio publicado no podía cambiar su estado. Su anuncio desaparece del
    // escaparate a media vida, por una edición.
    await fijarModos({ PHONE: 'BLOCK' });
    const anuncio = await crearAnuncio('Un sofá limpio, sin datos de contacto.', 'ACTIVE');
    const antes = await estado(anuncio.id);

    await editar(anuncio.id, `Un sofá limpio. ${TELEFONO}`).expect(200);

    const despues = await estado(anuncio.id);
    expect(despues.status).toBe('PENDING_REVIEW');
    // El plazo NO se toca: el anuncio no ha caducado, está en revisión. Reiniciarlo aquí
    // sería regalarle caducidad a quien acaba de tropezar.
    expect(despues.expiresAt).toEqual(antes.expiresAt);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 2 — LA PUERTA DE SALIDA (la que decide si esto vale algo)
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 2 (LA CRÍTICA): bloquea → el vendedor edita → SALE. El ciclo completo', async () => {
    await fijarModos({ PHONE: 'BLOCK' });
    const anuncio = await crearAnuncio('Una estantería.', 'ACTIVE');

    // (a) mete el teléfono: a la cola.
    await editar(anuncio.id, `Una estantería. ${TELEFONO}`).expect(200);
    expect((await estado(anuncio.id)).status).toBe('PENDING_REVIEW');

    // (b) LA MITAD QUE HACE QUE ESTO NO SEA UNA TRAMPA. `publish()` sólo admite DRAFT y de
    // `PENDING_REVIEW` sólo sacaba un moderador aprobando: sin esta salida, cada falso
    // positivo sería una espera indefinida por algo que el vendedor arregla solo.
    await editar(anuncio.id, 'Una estantería. Contacto por el chat.').expect(200);

    expect((await estado(anuncio.id)).status).toBe('ACTIVE');
    expect(await prisma.listingDetection.count({ where: { listingId: anuncio.id } })).toBe(0);
  });

  it('editar NUNCA falla, ni bloqueando ni liberando — es la vía de salida', async () => {
    await fijarModos({ PHONE: 'BLOCK' });
    const anuncio = await crearAnuncio('Un armario.', 'ACTIVE');
    await editar(anuncio.id, `Un armario. ${TELEFONO}`).expect(200);
    // El texto se guardó AUNQUE el anuncio se fuera a la cola: no se rechaza, se re-enruta.
    const fila = await prisma.listing.findUniqueOrThrow({ where: { id: anuncio.id } });
    expect(fila.description).toContain('654123456');
  });

  it('LO QUE NO LIBERA: una POLÍTICA encendida mantiene el anuncio en la cola', async () => {
    // La salida es sólo para lo que se bloqueó por el CONTENIDO. Si la plataforma revisa
    // todo, o la categoría o el vendedor están marcados, quitar el teléfono no satisface
    // eso — son decisiones que alguien tomó a mano y no las deshace una edición.
    await fijarModos({ PHONE: 'BLOCK' });
    const anuncio = await crearAnuncio('Una lámpara.', 'ACTIVE');
    await editar(anuncio.id, `Una lámpara. ${TELEFONO}`).expect(200);
    expect((await estado(anuncio.id)).status).toBe('PENDING_REVIEW');

    await prisma.user.update({ where: { id: sellerId }, data: { requiresReview: true } });
    await editar(anuncio.id, 'Una lámpara. Contacto por el chat.').expect(200);

    // El texto está limpio —la detección murió— y el anuncio SIGUE en la cola.
    expect(await prisma.listingDetection.count({ where: { listingId: anuncio.id } })).toBe(0);
    expect((await estado(anuncio.id)).status).toBe('PENDING_REVIEW');

    // Y al quitar la política, la siguiente edición ya sí lo libera.
    await prisma.user.update({ where: { id: sellerId }, data: { requiresReview: false } });
    await editar(anuncio.id, 'Una lámpara en buen estado.').expect(200);
    expect((await estado(anuncio.id)).status).toBe('ACTIVE');
  });

  it('la salida vale también para una PALABRA de la lista, y es un cambio anunciado', async () => {
    // La puerta no puede ser específica de un detector: el motivo por el que un anuncio
    // entró en la cola NO se persiste (`moderationSignals` son señales de AHORA), así que
    // la pregunta que se hace es «¿queda algún motivo?», no «¿por qué entró?».
    //
    // Consecuencia, y se dice: un anuncio encolado por una palabra prohibida que el vendedor
    // quita AHORA SE LIBERA SOLO. Antes se quedaba esperando a un moderador. `WORD` sigue
    // bloqueando exactamente igual — lo que cambia es que ahora hay salida.
    await fijarModos({});
    await prisma.setting.update({ where: { key: BAD_WORDS }, data: { value: ['estafa'] } });

    const anuncio = await crearAnuncio('Vendo cosas, palabra estafa incluida.');
    await request(server())
      .post(`/api/listings/${anuncio.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect((await estado(anuncio.id)).status).toBe('PENDING_REVIEW');

    await editar(anuncio.id, 'Vendo cosas, sin nada raro.').expect(200);
    expect((await estado(anuncio.id)).status).toBe('ACTIVE');

    await prisma.setting.update({ where: { key: BAD_WORDS }, data: { value: [] } });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 3 — ascender es cambiar un VALOR
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 3: el MISMO anuncio, los dos modos — sólo cambia el ajuste', async () => {
    const anuncio = await crearAnuncio('Un escritorio.', 'ACTIVE');

    await fijarModos({ PHONE: 'WARN' });
    await editar(anuncio.id, `Un escritorio. ${TELEFONO}`).expect(200);
    expect((await estado(anuncio.id)).status).toBe('ACTIVE');

    // Se asciende POR EL AJUSTE, con el endpoint real que usa el admin. Sin tocar el
    // detector, sin desplegar: si ascender exigiera otra rama de código, el diseño estaría
    // mal y esta barrera es la que lo diría.
    await request(server())
      .patch(`/api/admin/settings/${MODES}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: { WORD: 'BLOCK', IP: 'WARN', PHONE: 'BLOCK' } })
      .expect(200);

    await editar(anuncio.id, `Un escritorio grande. ${TELEFONO}`).expect(200);
    expect((await estado(anuncio.id)).status).toBe('PENDING_REVIEW');

    // Y degradar lo devuelve, sin haber perdido nada: bloquear era avisar más una
    // consecuencia, así que quitarla no destruye el rastro.
    await fijarModos({ PHONE: 'WARN' });
    await editar(anuncio.id, `Un escritorio muy grande. ${TELEFONO}`).expect(200);
    expect((await estado(anuncio.id)).status).toBe('ACTIVE');
    expect(await prisma.listingDetection.count({ where: { listingId: anuncio.id } })).toBe(1);
  });

  it('un ajuste ROTO no apaga el filtro de palabras', async () => {
    // La dirección del fail-open: cada clave cae a su defecto por separado, así que un
    // `detectionModes` a medio escribir no puede dejar `WORD` en avisar sin que nadie lo note.
    await prisma.setting.update({ where: { key: BAD_WORDS }, data: { value: ['estafa'] } });
    await fijarModos({ PHONE: 'bloquear_ya', NOPE: 'BLOCK' });

    const anuncio = await crearAnuncio('Esto es una estafa.');
    await request(server())
      .post(`/api/listings/${anuncio.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect((await estado(anuncio.id)).status).toBe('PENDING_REVIEW');
    await prisma.setting.update({ where: { key: BAD_WORDS }, data: { value: [] } });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 4 — el contador honesto
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 4: el contador da RECUENTOS EN BRUTO, y ninguna tasa', async () => {
    await fijarModos({ PHONE: 'BLOCK' });

    const res = await request(server())
      .get('/api/admin/detection/stats')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const filas = res.body as {
      detector: string;
      mode: string;
      listings: number;
      detections: number;
    }[];

    // LOS TRES SIEMPRE, también los que no han disparado nunca: un detector ausente se
    // leería como «no existe» en vez de como «no ha encontrado nada».
    expect(filas.map((f) => f.detector).sort()).toEqual(['IP', 'PHONE', 'WORD']);
    expect(filas.find((f) => f.detector === 'PHONE')?.mode).toBe('BLOCK');
    expect(filas.find((f) => f.detector === 'PHONE')!.listings).toBeGreaterThan(0);

    // LA AFIRMACIÓN DE HONESTIDAD, y es la razón de ser de esta barrera: el payload NO
    // contiene ninguna tasa, ningún porcentaje y ninguna palabra que sugiera acierto.
    // Medir falsos positivos exige un veredicto humano por hallazgo, que no existe. Un
    // número con decimales sacado de un recuento convencería más de lo que mide.
    const claves = new Set(filas.flatMap((f) => Object.keys(f)));
    expect(claves).toEqual(new Set(['detector', 'mode', 'listings', 'detections']));
    for (const clave of claves) {
      expect(clave).not.toMatch(/rate|ratio|percent|accuracy|falsePositive|precision/i);
    }

    // Y los dos recuentos son cosas distintas: hallazgos ≥ anuncios, siempre.
    for (const f of filas) expect(f.detections).toBeGreaterThanOrEqual(f.listings);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Lo que NO cambia
  // ───────────────────────────────────────────────────────────────────────────

  it('el STAFF editando sigue sin mover el estado, también con el detector en BLOQUEAR', async () => {
    // La regla de la ráfaga A no cede al ascender: un cambio de estado es una consecuencia
    // sobre el VENDEDOR, y un moderador no puede provocarla con su propia mano.
    await fijarModos({ PHONE: 'BLOCK' });
    const anuncio = await crearAnuncio('Una silla.', 'ACTIVE');

    await request(server())
      .patch(`/api/admin/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: `Una silla. ${TELEFONO}`, reason: 'Prueba de la separación' })
      .expect(200);

    expect((await estado(anuncio.id)).status).toBe('ACTIVE');
    // Pero las detecciones SÍ se refrescan: son un hecho sobre el texto.
    expect(await prisma.listingDetection.count({ where: { listingId: anuncio.id } })).toBe(1);
  });

  it('P1 sigue intacto: bloquear no toca `triage` ni `watched`', async () => {
    await fijarModos({ PHONE: 'BLOCK' });
    const anuncio = await crearAnuncio('Un espejo.', 'ACTIVE');
    await prisma.listing.update({
      where: { id: anuncio.id },
      data: { triage: 'REVIEWED', watched: true },
    });

    await editar(anuncio.id, `Un espejo. ${TELEFONO}`).expect(200);

    const despues = await estado(anuncio.id);
    expect(despues.status).toBe('PENDING_REVIEW');
    // El triaje lo mueve P1 (REVIEWED → EDITED al editar el dueño), no la detección. Y la
    // vigilancia, que es un juicio humano, no la toca nadie.
    expect(despues.triage).toBe('EDITED');
    expect(despues.watched).toBe(true);
  });
});
