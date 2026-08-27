/**
 * A2 — LA LISTA DE TELÉFONOS MARCADOS (`PHONE_LIST`).
 *
 * Cuatro barreras:
 *
 *  1. **Casa en CUALQUIER formato**, porque los dos lados se canonizan con el mismo
 *     reconocedor que ya usaban el detector heurístico y la columna de búsqueda. Ni el admin
 *     ni el vendedor tienen por qué escribirlo igual.
 *
 *  2. **La ASIMETRÍA de campos.** `PHONE_LIST` mira también `Listing.phone`; el heurístico
 *     no. Un número marcado lo está esté donde esté; un teléfono en su propio campo —servido
 *     tras `JwtAuthGuard`— no esquiva nada, y avisar de eso sería avisar de que el vendedor
 *     usó el canal correcto.
 *
 *  3. **CONVIVEN.** Un número marcado en la descripción dispara los DOS, distinguibles: el
 *     heurístico dice «hay un teléfono fuera de su sitio» y la lista «ese número está
 *     marcado». Dos preguntas, dos respuestas.
 *
 *  4. **Nace AVISANDO.** El anuncio sigue ACTIVE. Y asciende cambiando el ajuste, con el
 *     mecanismo de la ráfaga B, sin tocar el detector.
 *
 * Ver `docs/diseno-listas-ip-telefono.md` §A.2.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { ajustesDeSuite, preservarAjustes } from './helpers/settings';
import { normalizarTelefono } from '../src/modules/moderation/detection/phone-format';

const TELEFONOS = 'flaggedPhones';
const MODOS = 'detectionModes';
const PALABRAS = 'badWordList';
const CUOTA = 'freeActiveListingLimit';
const MARCADO = '654123456';

describe('A2 — teléfonos marcados (e2e)', () => {
  // LOS CUATRO AJUSTES COMPARTIDOS QUE ESTA SUITE TOCA, en un solo sitio.
  //
  // Dos se fijan de entrada porque el FIXTURE los necesita: `badWordList` a vacío (una
  // entrada dejada por otra suite mandaría estos anuncios a revisión y el rojo parecería
  // de A2 — pasó al escribir esto) y la CUOTA de activos a 500 (el mismo vendedor publica
  // en casi todos los casos y toparía con el tope).
  //
  // Los otros dos —`flaggedPhones` y `detectionModes`— son el OBJETO DE ESTUDIO: los
  // escriben los propios casos. De esos sólo hace falta la red debajo, para que la suite
  // los devuelva a su fila exacta al terminar.
  //
  // `cleanDb` no limpia `Setting` a propósito y el seed sólo corre una vez por corrida,
  // así que lo que esta suite deje puesto se lo come la siguiente. Ver `helpers/settings.ts`.
  ajustesDeSuite({ [PALABRAS]: [], [CUOTA]: 500 });
  preservarAjustes([TELEFONOS, MODOS]);

  let app: INestApplication;
  let prisma: PrismaClient;

  let sellerId: string;
  let sellerToken: string;
  let adminToken: string;
  let categoryId: string;

  const server = () => app.getHttpServer();

  let n = 0;
  const crearAnuncio = (description: string, phone: string | null = null) =>
    prisma.listing.create({
      data: {
        title: `A2 ${++n}`,
        slug: `a2-${n}-${Date.now()}`,
        description,
        price: 10,
        type: 'PRODUCT',
        status: 'ACTIVE',
        sellerId,
        categoryId,
        phone,
        phoneNormalized: normalizarTelefono(phone),
      },
    });

  /** Fuerza una pasada del motor por el camino del staff — no mueve el estado (ráfaga A). */
  const repasar = (id: string) =>
    request(server())
      .patch(`/api/admin/listings/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Forzar una pasada del motor' })
      .expect(200);

  const detecciones = (listingId: string) =>
    prisma.listingDetection.findMany({
      where: { listingId },
      orderBy: [{ detector: 'asc' }, { field: 'asc' }],
    });

  const estado = (id: string) =>
    prisma.listing.findUniqueOrThrow({ where: { id }, select: { status: true } });

  const fijar = async (key: string, valor: unknown) => {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: valor as never },
      update: { value: valor as never },
    });
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [seller] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'a2-seller@example.com', name: 'A2 Seller', slug: 'a2-seller',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'a2-admin@example.com', name: 'A2 Admin', slug: 'a2-admin',
          passwordHash, emailVerified: true, role: 'ADMIN',
        },
      }),
    ]);
    sellerId = seller.id;

    categoryId = (
      await prisma.category.create({
        data: { name: 'A2 Cat', slug: 'a2-cat', attributeSchema: [] },
      })
    ).id;

    [sellerToken, adminToken] = await Promise.all([
      request(server())
        .post('/api/auth/login')
        .send({ email: 'a2-seller@example.com', password: 'Test1234!' })
        .then((r) => r.body.accessToken as string),
      request(server())
        .post('/api/auth/admin-login')
        .send({ email: 'a2-admin@example.com', password: 'Test1234!' })
        .then((r) => r.body.accessToken as string),
    ]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 1 — cualquier formato
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 1: la lista lleva un formato y el anuncio otro, y casan', async () => {
    await fijar(TELEFONOS, ['+34 654 123 456']);
    const anuncio = await crearAnuncio('Interesados al 654-12-34-56, gracias.');
    await repasar(anuncio.id);

    const deLista = (await detecciones(anuncio.id)).filter((d) => d.detector === 'PHONE_LIST');
    expect(deLista).toHaveLength(1);
    // `rule` es la entrada TAL COMO LA ESCRIBIÓ el admin: tiene que reconocer su regla.
    expect(deLista[0].rule).toBe('+34 654 123 456');
    expect(deLista[0].field).toBe('DESCRIPTION');
  });

  it('un teléfono que no está en la lista no la dispara', async () => {
    await fijar(TELEFONOS, [MARCADO]);
    const anuncio = await crearAnuncio('Llama al 611 222 333.');
    await repasar(anuncio.id);

    const filas = await detecciones(anuncio.id);
    expect(filas.filter((d) => d.detector === 'PHONE_LIST')).toEqual([]);
    // Pero el heurístico sí avisa: hay un teléfono fuera de su sitio, marcado o no.
    expect(filas.map((d) => d.detector)).toEqual(['PHONE']);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 2 — la asimetría de campos
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 2: el campo `phone` lo mira PHONE_LIST y NO el heurístico', async () => {
    await fijar(TELEFONOS, [MARCADO]);
    // El número marcado está en SU SITIO — el campo legítimo, servido tras login — y no en
    // el texto. El heurístico no tiene nada que decir; la lista sí.
    const anuncio = await crearAnuncio('Sin datos de contacto en el texto.', '654 123 456');
    await repasar(anuncio.id);

    const filas = await detecciones(anuncio.id);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      detector: 'PHONE_LIST',
      field: 'PHONE',
      rule: MARCADO,
    });
  });

  it('y un teléfono NO marcado en su campo no dispara NADA', async () => {
    // La otra mitad: el heurístico sigue sin mirar ahí. Si lo hiciera, avisaría de que el
    // vendedor usó el canal correcto — el aviso más inútil posible.
    await fijar(TELEFONOS, ['611222333']);
    const anuncio = await crearAnuncio('Sin datos de contacto.', '654123456');
    await repasar(anuncio.id);
    expect(await detecciones(anuncio.id)).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 3 — convivencia
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 3: un número marcado EN EL TEXTO dispara los DOS, distinguibles', async () => {
    await fijar(TELEFONOS, [MARCADO]);
    const anuncio = await crearAnuncio(`Llama al ${MARCADO}.`);
    await repasar(anuncio.id);

    const filas = await detecciones(anuncio.id);
    // Dos preguntas sobre el mismo número: «está fuera de su sitio» y «está marcado».
    expect(filas.map((d) => d.detector)).toEqual(['PHONE', 'PHONE_LIST']);
    expect(filas.every((d) => d.field === 'DESCRIPTION')).toBe(true);
  });

  it('el heurístico sigue INTACTO: avisa de cualquier teléfono, con lista o sin ella', async () => {
    await fijar(TELEFONOS, []);
    const anuncio = await crearAnuncio('Llama al 611 222 333.');
    await repasar(anuncio.id);
    expect((await detecciones(anuncio.id)).map((d) => d.detector)).toEqual(['PHONE']);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 4 — nace avisando, y asciende
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 4: nace AVISANDO — publicar con un número marcado deja el anuncio ACTIVE', async () => {
    await fijar(TELEFONOS, [MARCADO]);
    await fijar(MODOS, {});
    const anuncio = await prisma.listing.create({
      data: {
        title: 'A2 publicar avisando',
        slug: `a2-pub-${Date.now()}`,
        description: `Llama al ${MARCADO}.`,
        price: 10, type: 'PRODUCT', status: 'DRAFT', sellerId, categoryId,
      },
    });

    await request(server())
      .post(`/api/listings/${anuncio.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect((await estado(anuncio.id)).status).toBe('ACTIVE');
    expect(
      (await detecciones(anuncio.id)).some((d) => d.detector === 'PHONE_LIST'),
    ).toBe(true);
  });

  it('y ASCIENDE cambiando el ajuste, sin tocar el detector', async () => {
    await fijar(TELEFONOS, [MARCADO]);
    await fijar(MODOS, { PHONE_LIST: 'BLOCK' });
    const anuncio = await prisma.listing.create({
      data: {
        title: 'A2 publicar bloqueando',
        slug: `a2-blo-${Date.now()}`,
        description: `Llama al ${MARCADO}.`,
        price: 10, type: 'PRODUCT', status: 'DRAFT', sellerId, categoryId,
      },
    });

    await request(server())
      .post(`/api/listings/${anuncio.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    // El MISMO anuncio y el MISMO detector: sólo cambió un valor del ajuste.
    expect((await estado(anuncio.id)).status).toBe('PENDING_REVIEW');
    await fijar(MODOS, {});
  });

  it('el vendedor SALE editando, también de un bloqueo por la lista', async () => {
    // La puerta de salida de la ráfaga B vale igual para este detector: bloquear sin salida
    // convierte cada número mal marcado en una espera indefinida por algo que el vendedor
    // arregla solo.
    await fijar(TELEFONOS, [MARCADO]);
    await fijar(MODOS, { PHONE_LIST: 'BLOCK' });
    const anuncio = await crearAnuncio(`Llama al ${MARCADO}.`);

    await request(server())
      .patch(`/api/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ description: `Llama al ${MARCADO} de verdad.` })
      .expect(200);
    expect((await estado(anuncio.id)).status).toBe('PENDING_REVIEW');

    await request(server())
      .patch(`/api/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ description: 'Contacto por el chat de la plataforma.' })
      .expect(200);
    expect((await estado(anuncio.id)).status).toBe('ACTIVE');
    await fijar(MODOS, {});
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Lo que se ve, y lo que no rompe
  // ───────────────────────────────────────────────────────────────────────────

  it('la ficha sirve las dos detecciones con su fragmento y su regla', async () => {
    await fijar(TELEFONOS, [MARCADO]);
    const anuncio = await crearAnuncio(`Llama al ${MARCADO}.`);
    await repasar(anuncio.id);

    const res = await request(server())
      .get(`/api/admin/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const detectores = (res.body.detections as { detector: string; rule: string | null }[]);
    expect(detectores.map((d) => d.detector).sort()).toEqual(['PHONE', 'PHONE_LIST']);
    // El heurístico no tiene regla que enseñar; la lista sí, y es la del admin.
    expect(detectores.find((d) => d.detector === 'PHONE')?.rule).toBeNull();
    expect(detectores.find((d) => d.detector === 'PHONE_LIST')?.rule).toBe(MARCADO);
  });

  it('la lista se filtra por su detector, como cualquier otro', async () => {
    await fijar(TELEFONOS, [MARCADO]);
    const marcado = await crearAnuncio(`Llama al ${MARCADO}.`);
    const otro = await crearAnuncio('Llama al 611 222 333.');
    await repasar(marcado.id);
    await repasar(otro.id);

    const res = await request(server())
      .get('/api/admin/listings?detector=PHONE_LIST&perPage=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const ids = (res.body.items as { id: string }[]).map((l) => l.id);
    expect(ids).toContain(marcado.id);
    expect(ids).not.toContain(otro.id);
  });

  it('una entrada mal escrita no impide que el resto de la lista funcione', async () => {
    await fijar(TELEFONOS, ['no-es-un-telefono', '12345', MARCADO]);
    const anuncio = await crearAnuncio(`Llama al ${MARCADO}.`);
    await repasar(anuncio.id);
    expect(
      (await detecciones(anuncio.id)).filter((d) => d.detector === 'PHONE_LIST'),
    ).toHaveLength(1);
  });

  it('WORD sigue bloqueando: A2 no toca nada de lo anterior', async () => {
    await fijar(TELEFONOS, [MARCADO]);
    const original = (await prisma.setting.findUnique({ where: { key: 'badWordList' } }))?.value;
    await fijar('badWordList', ['estafa']);

    const anuncio = await prisma.listing.create({
      data: {
        title: 'Vendo estafa',
        slug: `a2-word-${Date.now()}`,
        description: 'Un anuncio con palabra prohibida.',
        price: 10, type: 'PRODUCT', status: 'DRAFT', sellerId, categoryId,
      },
    });
    await request(server())
      .post(`/api/listings/${anuncio.id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect((await estado(anuncio.id)).status).toBe('PENDING_REVIEW');
    await fijar('badWordList', original ?? []);
  });
});
