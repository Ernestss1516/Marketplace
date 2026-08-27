/**
 * PÓSTER ANIMADO P1 — EL ARTEFACTO Y EL DATO (e2e).
 *
 * P1 **no pinta nada**: el sprite se captura en el navegador, se sube a `listing-previews/` y
 * se guarda en `Listing.videoPreviewUrl`. Quien lo enseñe será P2. Lo que se fija aquí es que
 * el dato exista bien, con su puerta y con su basura recogida.
 *
 * Las barreras de esta ráfaga (diseño §9):
 *   · B-1 — el barrido INTACTO: un anuncio CON previsualización sigue sin filtrar
 *           `listing-videos/` a ningún payload de lista. El sprite es una imagen y vive en
 *           otro prefijo, así que el test que guarda la garantía no cambia ni una letra.
 *   · B-3 — la limpieza de los TRES objetos, **con H-2 cerrado**: quitar el vídeo,
 *           sustituirlo y borrar el anuncio dejan cero ficheros suyos en el bucket. Hasta
 *           esta ráfaga, `removeVideo` sólo borraba el `.mp4` y el póster se quedaba.
 *   · B-4 — el sprite NO puede tumbar el vídeo: sin `previewKey`, con uno que nunca aterrizó
 *           o con uno que no pasa los topes, el vídeo se confirma igual.
 *   · B-5 — el gate del camino nuevo: `POST /video/preview-url` rechaza a un no-Pro, con el
 *           flag apagado y sobre un anuncio ajeno — los tres.
 *   · B-7 — la confirmación rechaza un `previewKey` de otro anuncio (400).
 *   · B-8 — el artefacto es una IMAGEN FIJA: la firma no admite ningún formato animado.
 *           (La otra mitad —que el blob salga con el ancho de N fotogramas— se fija en el
 *           test unitario del cliente, que es donde se captura.)
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { ajustesDeSuite } from './helpers/settings';
import { R2Service } from 'src/infra/r2/r2.service';
import {
  MAX_PREVIEW_BYTES,
  PREVIEW_KEY_PREFIX,
  VIDEO_ENABLED_SETTING,
  VIDEO_KEY_PREFIX,
} from 'src/modules/video/video-limits';
import { isOwnStorageUrl } from 'src/common/validators/safe-url';

describe('Póster animado P1 — el artefacto y el dato (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let r2: R2Service;

  let proToken: string;
  let freeToken: string;
  let adminToken: string;
  let proUserId: string;
  let freeUserId: string;
  let categoryId: string;

  // La feature encendida para toda la suite, y la fila devuelta a como estaba (no repuesta
  // a un literal — ver el comentario de `video-infra`).
  ajustesDeSuite({ [VIDEO_ENABLED_SETTING]: true });

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    r2 = app.get(R2Service);

    categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } })).id;
    const hash = await bcrypt.hash('Test1234!', 4);

    const pro = await prisma.user.create({
      data: { email: 'p1-pro@example.com', name: 'P1 Pro', slug: 'p1-pro', passwordHash: hash, emailVerified: true },
    });
    proUserId = pro.id;
    const free = await prisma.user.create({
      data: { email: 'p1-free@example.com', name: 'P1 Free', slug: 'p1-free', passwordHash: hash, emailVerified: true },
    });
    freeUserId = free.id;
    await prisma.user.create({
      data: {
        email: 'p1-admin@example.com',
        name: 'P1 Admin',
        slug: 'p1-admin',
        passwordHash: hash,
        emailVerified: true,
        role: 'ADMIN',
      },
    });

    await hacerPro(proUserId);
    proToken = await login('p1-pro@example.com');
    freeToken = await login('p1-free@example.com');
    adminToken = (
      await request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'p1-admin@example.com', password: 'Test1234!' })
        .expect(200)
    ).body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Test1234!' });
    return res.body.accessToken as string;
  }

  /** Suscripción + entitlement activos: lo que `isProActive` consulta. */
  async function hacerPro(userId: string) {
    const price = await prisma.price.findFirstOrThrow({
      where: { interval: 'MONTH', product: { type: 'RECURRING' } },
    });
    const sub = await prisma.subscription.create({
      data: {
        userId,
        priceId: price.id,
        status: 'ACTIVE',
        gatewaySubscriptionId: `sub_p1_${userId}`,
        currentPeriodStart: new Date(Date.now() - 86_400_000),
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    await prisma.entitlement.create({
      data: {
        userId,
        type: 'PRO_SUBSCRIPTION',
        subscriptionId: sub.id,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
  }

  const encender = (on: boolean) =>
    prisma.setting.upsert({
      where: { key: VIDEO_ENABLED_SETTING },
      create: { key: VIDEO_ENABLED_SETTING, value: on },
      update: { value: on },
    });

  let n = 0;
  async function crearAnuncio(
    marca: string,
    sellerId = proUserId,
    status: ListingStatus = ListingStatus.ACTIVE,
  ) {
    n += 1;
    return prisma.listing.create({
      data: {
        title: `P1 ${marca}`,
        slug: `p1-${marca}-${n}-${Math.random().toString(36).slice(2)}`,
        description: 'Anuncio para el póster animado',
        price: new Prisma.Decimal('100.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status,
        sellerId,
        categoryId,
        publishedAt: new Date(),
      },
      select: { id: true, slug: true },
    });
  }

  const pedirPreviewUrl = (token: string, body: object) =>
    request(app.getHttpServer())
      .post('/api/video/preview-url')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const previewValido = (listingId: string, over: Record<string, unknown> = {}) => ({
    listingId,
    contentType: 'image/webp',
    sizeBytes: 2048,
    ...over,
  });

  const confirmar = (listingId: string, body: object, token = proToken) =>
    request(app.getHttpServer())
      .post(`/api/video/listings/${listingId}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  /** Firma y sube de verdad un `.mp4`; devuelve su clave temporal. */
  async function subirVideo(listingId: string): Promise<string> {
    const contenido = Buffer.from('mp4 de prueba para P1');
    const res = await request(app.getHttpServer())
      .post('/api/video/upload-url')
      .set('Authorization', `Bearer ${proToken}`)
      .send({ listingId, contentType: 'video/mp4', sizeBytes: contenido.length, durationSeconds: 20 })
      .expect(201);
    await fetch(res.body.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(contenido.length) },
      body: contenido,
    });
    return res.body.key as string;
  }

  /** Firma y sube de verdad un sprite; devuelve su clave temporal. */
  async function subirSprite(listingId: string): Promise<string> {
    const contenido = Buffer.from('los cinco fotogramas, en una tira');
    const res = await pedirPreviewUrl(proToken, previewValido(listingId, { sizeBytes: contenido.length })).expect(201);
    await fetch(res.body.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/webp', 'Content-Length': String(contenido.length) },
      body: contenido,
    });
    return res.body.key as string;
  }

  /** Un póster ya subido, por el camino de imágenes (que es de donde viene hoy). */
  async function subirPoster(): Promise<string> {
    n += 1;
    const key = `media/p1-poster-${n}-${Math.random().toString(36).slice(2)}.jpg`;
    await r2.upload(key, Buffer.from('un jpeg de mentira'), 'image/jpeg');
    return r2.getPublicUrl(key);
  }

  /** La clave de un objeto a partir de su URL pública. */
  const claveDe = (url: string) => url.slice(r2.getPublicUrl('').length);

  /** Sube vídeo + póster + sprite y los confirma. Devuelve las tres URLs guardadas. */
  async function anuncioConLosTres(marca: string) {
    const listing = await crearAnuncio(marca);
    const key = await subirVideo(listing.id);
    const previewKey = await subirSprite(listing.id);
    const posterUrl = await subirPoster();

    await confirmar(listing.id, { key, durationSeconds: 20, posterUrl, previewKey }).expect(201);

    const guardado = await prisma.listing.findUniqueOrThrow({
      where: { id: listing.id },
      select: { videoUrl: true, videoPosterUrl: true, videoPreviewUrl: true },
    });
    expect(guardado.videoUrl).not.toBeNull();
    expect(guardado.videoPosterUrl).not.toBeNull();
    expect(guardado.videoPreviewUrl).not.toBeNull();
    return { listing, ...guardado } as {
      listing: { id: string; slug: string };
      videoUrl: string;
      videoPosterUrl: string;
      videoPreviewUrl: string;
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  El camino feliz — el dato existe y está donde debe
  // ═══════════════════════════════════════════════════════════════════════════

  describe('el sprite se firma, se sube y se guarda', () => {
    it('se firma contra `listing-previews/tmp/<anuncio>/` — NO contra el prefijo de vídeo', async () => {
      const listing = await crearAnuncio('firma');
      const res = await pedirPreviewUrl(proToken, previewValido(listing.id)).expect(201);

      expect(res.body.key).toContain(`${PREVIEW_KEY_PREFIX}/tmp/${listing.id}/`);
      // LA FRONTERA: el sprite es una imagen que SÍ podrá viajar a las tarjetas, así que no
      // puede vivir bajo el prefijo que el barrido busca para dar la garantía por rota.
      expect(res.body.key).not.toContain(VIDEO_KEY_PREFIX);
      expect(res.body.requiredHeaders['Content-Type']).toBe('image/webp');
    });

    it('el confirm lo saca de `tmp/` y guarda la URL en videoPreviewUrl', async () => {
      const { listing, videoPreviewUrl } = await anuncioConLosTres('guardado');

      expect(videoPreviewUrl).toContain(`${PREVIEW_KEY_PREFIX}/${listing.id}/`);
      expect(videoPreviewUrl).not.toContain('/tmp/');
      // De NUESTRO almacenamiento: en P2 será una `url()` de CSS, que no pasa por
      // `remotePatterns` — la misma excepción que el `<video src>` de la ficha.
      expect(isOwnStorageUrl(videoPreviewUrl)).toBe(true);
      expect(await r2.head(claveDe(videoPreviewUrl))).not.toBeNull();
    });

    it('P1 NO PINTA NADA: la tarjeta sigue sirviendo sólo `hasVideo`', async () => {
      const { listing } = await anuncioConLosTres('sin-pintar');

      const res = await request(app.getHttpServer())
        .get('/api/users/me/listings')
        .set('Authorization', `Bearer ${proToken}`)
        .expect(200);

      const tarjeta = (res.body.items as Record<string, unknown>[]).find(
        (l) => l.id === listing.id,
      )!;
      expect(tarjeta.hasVideo).toBe(true);
      // La superficie es exactamente la de antes de esta ráfaga. Enseñarlo es P2, y hasta
      // entonces el dato existe sin que ninguna pantalla dependa de él.
      expect(tarjeta.videoPreviewUrl).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  B-1 — el barrido, intacto
  // ═══════════════════════════════════════════════════════════════════════════

  describe('B-1 — la garantía del cero-bytes-en-listas no se toca', () => {
    /**
     * LA FRONTERA, COMPROBADA EN EL ORIGEN Y NO SÓLO EN EL PAYLOAD — y hay que decir por qué.
     *
     * En P1 la URL del sprite **todavía no viaja a ninguna lista** (P2 la mete en el `select`
     * de tarjeta y en el documento indexado). Así que el barrido de cadena de aquí abajo, tal
     * como está, **no puede cazar** que alguien mude el sprite al prefijo de vídeo: no hay
     * nada que barrer. Se pondría rojo el día de P2, cuando ya sería tarde.
     *
     * Esto sí lo caza hoy: se mira lo que se GUARDA. Es la misma garantía un paso antes, y es
     * la que hace que el prefijo sea una frontera de verdad desde la ráfaga que crea el
     * objeto — no desde la que lo enseña.
     */
    it('la URL guardada del sprite NUNCA cae bajo el prefijo del vídeo', async () => {
      const { videoPreviewUrl, videoUrl } = await anuncioConLosTres('frontera');

      expect(videoPreviewUrl).toContain(`${PREVIEW_KEY_PREFIX}/`);
      expect(videoPreviewUrl).not.toContain(`${VIDEO_KEY_PREFIX}/`);
      // Y el vídeo sigue donde siempre: los dos prefijos existen y no se tocan.
      expect(videoUrl).toContain(`${VIDEO_KEY_PREFIX}/`);
    });

    it('un anuncio CON previsualización sigue sin filtrar `listing-videos/` a la lista', async () => {
      await anuncioConLosTres('barrido');

      const res = await request(app.getHttpServer())
        .get('/api/users/me/listings')
        .set('Authorization', `Bearer ${proToken}`)
        .expect(200);

      // El MISMO barrido que guarda la garantía desde la ráfaga de visualización, palabra por
      // palabra. Que siga verde sin tocarlo es la prueba de que el prefijo es una frontera
      // real: el sprite es una imagen y vive en otro sitio.
      expect(JSON.stringify(res.body)).not.toContain(`${VIDEO_KEY_PREFIX}/`);
    });

    it('y tampoco por la ficha pública, que sí sirve el vídeo', async () => {
      const { listing } = await anuncioConLosTres('barrido-ficha');

      const res = await request(app.getHttpServer())
        .get(`/api/listings/${listing.slug}`)
        .expect(200);

      // En la FICHA la dirección del vídeo sí viaja (es donde se ve). Lo que se comprueba
      // aquí es lo otro: que la lista blanca de la ficha no ha dejado entrar el sprite por
      // la puerta de atrás — P1 no lo sirve en ninguna superficie.
      expect(res.body.videoUrl).toContain(`${VIDEO_KEY_PREFIX}/`);
      expect(res.body.videoPreviewUrl).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  B-3 — la limpieza de los TRES, con H-2 cerrado
  // ═══════════════════════════════════════════════════════════════════════════

  describe('B-3 — los tres objetos se van con el vídeo', () => {
    /**
     * H-2, EL HALLAZGO QUE ESTA RÁFAGA CIERRA. `removeVideo` ponía `videoPosterUrl: null` en
     * la fila y **sólo borraba el `.mp4`**: el póster se quedaba huérfano en el bucket cada
     * vez que alguien quitaba su vídeo. No se veía porque la fila quedaba limpia.
     */
    it('QUITAR el vídeo borra los tres: .mp4, póster Y sprite', async () => {
      const { listing, videoUrl, videoPosterUrl, videoPreviewUrl } = await anuncioConLosTres('quitar');

      await request(app.getHttpServer())
        .delete(`/api/video/listings/${listing.id}`)
        .set('Authorization', `Bearer ${proToken}`)
        .expect(200);

      for (const url of [videoUrl, videoPosterUrl, videoPreviewUrl]) {
        expect(await r2.head(claveDe(url))).toBeNull();
      }

      const tras = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { videoUrl: true, videoPosterUrl: true, videoPreviewUrl: true },
      });
      expect(tras.videoUrl).toBeNull();
      expect(tras.videoPosterUrl).toBeNull();
      expect(tras.videoPreviewUrl).toBeNull();
    });

    it('SUSTITUIR el vídeo borra los tres anteriores y deja los tres nuevos', async () => {
      const anterior = await anuncioConLosTres('sustituir');
      const { listing } = anterior;

      const key = await subirVideo(listing.id);
      const previewKey = await subirSprite(listing.id);
      const posterUrl = await subirPoster();
      await confirmar(listing.id, { key, durationSeconds: 30, posterUrl, previewKey }).expect(201);

      // Los viejos, fuera.
      for (const url of [anterior.videoUrl, anterior.videoPosterUrl, anterior.videoPreviewUrl]) {
        expect(await r2.head(claveDe(url))).toBeNull();
      }

      // Y los nuevos, dentro.
      const ahora = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { videoUrl: true, videoPosterUrl: true, videoPreviewUrl: true },
      });
      for (const url of [ahora.videoUrl!, ahora.videoPosterUrl!, ahora.videoPreviewUrl!]) {
        expect(await r2.head(claveDe(url))).not.toBeNull();
      }
    });

    it('BORRAR el anuncio se lleva los tres (por `listingMediaKeys`, un solo lector)', async () => {
      const { listing, videoUrl, videoPosterUrl, videoPreviewUrl } = await anuncioConLosTres('borrar');

      // Vaciar un anuncio exige archivarlo antes (los dos pasos son la salvaguarda de
      // `deleteListing`). Se pone el estado directamente porque lo que este caso observa es
      // la LIMPIEZA, no el camino del archivado, que tiene sus propias barreras.
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: ListingStatus.ARCHIVED },
      });

      await request(app.getHttpServer())
        .delete(`/api/admin/listings/${listing.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      // La limpieza va por cola: se espera a que el worker despache las tres claves.
      await esperarAQueDesaparezcan([videoUrl, videoPosterUrl, videoPreviewUrl].map(claveDe));
    });

    /** La cola de limpieza es asíncrona; se sondea con plazo en vez de dormir a ciegas. */
    async function esperarAQueDesaparezcan(keys: string[]) {
      const limite = Date.now() + 20_000;
      for (;;) {
        const cabezas = await Promise.all(keys.map((k) => r2.head(k)));
        if (cabezas.every((c) => c === null)) return;
        if (Date.now() > limite) {
          const vivas = keys.filter((_, i) => cabezas[i] !== null);
          throw new Error(`Estas claves no se borraron a tiempo: ${vivas.join(', ')}`);
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  B-4 — el sprite no puede tumbar el vídeo
  // ═══════════════════════════════════════════════════════════════════════════

  describe('B-4 — la previsualización es opcional de verdad', () => {
    it('SIN previewKey (la captura devolvió null): el vídeo se confirma y la columna queda null', async () => {
      const listing = await crearAnuncio('sin-preview');
      const key = await subirVideo(listing.id);

      const res = await confirmar(listing.id, { key, durationSeconds: 15 }).expect(201);
      expect(res.body.hasVideo).toBe(true);
      expect(res.body.videoPreviewUrl).toBeNull();
    });

    it('con un previewKey cuyo objeto NUNCA aterrizó: el vídeo se confirma igual', async () => {
      const listing = await crearAnuncio('preview-fantasma');
      const key = await subirVideo(listing.id);

      // Forma correcta (temporal, de este anuncio) pero sin objeto detrás: es lo que deja un
      // PUT del sprite que se cayó a mitad. El vídeo NO puede pagarlo.
      const res = await confirmar(listing.id, {
        key,
        durationSeconds: 15,
        previewKey: `${PREVIEW_KEY_PREFIX}/tmp/${listing.id}/no-existe.webp`,
      }).expect(201);

      expect(res.body.hasVideo).toBe(true);
      expect(res.body.videoPreviewUrl).toBeNull();
    });

    it('y con un sprite que no pasa los topes: se descarta, se borra, y el vídeo se guarda', async () => {
      const listing = await crearAnuncio('preview-gorda');
      const key = await subirVideo(listing.id);

      // Se coloca a mano un objeto en el temporal, saltándose la firma (que lo habría
      // rechazado): es lo que comprueba que el segundo cinturón —el `HEAD` contra lo que de
      // verdad aterrizó— existe y muerde.
      const previewKey = `${PREVIEW_KEY_PREFIX}/tmp/${listing.id}/enorme.webp`;
      await r2.upload(previewKey, Buffer.alloc(MAX_PREVIEW_BYTES + 1, 7), 'image/webp');

      const res = await confirmar(listing.id, { key, durationSeconds: 15, previewKey }).expect(201);

      expect(res.body.hasVideo).toBe(true);
      expect(res.body.videoPreviewUrl).toBeNull();
      expect(await r2.head(previewKey)).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  B-5 — el gate del camino nuevo
  // ═══════════════════════════════════════════════════════════════════════════

  describe('B-5 — `preview-url` hereda el gate entero del vídeo', () => {
    it('un NO-Pro no puede, aunque llame directamente a la API', async () => {
      const listing = await crearAnuncio('gate-no-pro', freeUserId);
      const res = await pedirPreviewUrl(freeToken, previewValido(listing.id)).expect(403);
      expect(res.body.code).toBe('PRO_REQUIRED');
    });

    it('ni un Pro sobre el anuncio de otro', async () => {
      const ajeno = await crearAnuncio('gate-ajeno', freeUserId);
      await pedirPreviewUrl(proToken, previewValido(ajeno.id)).expect(403);
    });

    it('ni sobre un anuncio que no está activo', async () => {
      const vendido = await crearAnuncio('gate-vendido', proUserId, ListingStatus.SOLD);
      await pedirPreviewUrl(proToken, previewValido(vendido.id)).expect(400);
    });

    it('con la feature APAGADA no puede nadie, ni siendo Pro', async () => {
      const listing = await crearAnuncio('gate-apagada');
      await encender(false);
      try {
        const res = await pedirPreviewUrl(proToken, previewValido(listing.id)).expect(400);
        expect(res.body.code).toBe('VIDEO_DISABLED');
      } finally {
        await encender(true);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  B-7 — la clave ajena
  // ═══════════════════════════════════════════════════════════════════════════

  describe('B-7 — un previewKey de otro anuncio se rechaza', () => {
    it('confirmar en tu anuncio el sprite subido para otro da 400', async () => {
      const mio = await crearAnuncio('key-mio');
      const otro = await crearAnuncio('key-otro');

      const key = await subirVideo(mio.id);
      const ajeno = await subirSprite(otro.id);

      // El dueño está EN LA CLAVE, que es lo que permite rechazarlo sin guardar ningún estado
      // entre firmar y confirmar. Mismo cuerpo que el `key` del vídeo.
      await confirmar(mio.id, { key, durationSeconds: 15, previewKey: ajeno }).expect(400);

      // Y no ha quedado a medias: el vídeo tampoco se confirmó.
      const tras = await prisma.listing.findUniqueOrThrow({
        where: { id: mio.id },
        select: { videoUrl: true, videoPreviewUrl: true },
      });
      expect(tras.videoUrl).toBeNull();
      expect(tras.videoPreviewUrl).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  B-8 (mitad servidor) — el artefacto es una imagen fija
  // ═══════════════════════════════════════════════════════════════════════════

  describe('B-8 — ningún formato animado entra por la firma', () => {
    it('rechaza GIF y cualquier otro tipo que no sea WebP o JPEG', async () => {
      const listing = await crearAnuncio('formato');
      // `image/gif` es el que importa: admitirlo convertiría el artefacto en algo que anima
      // solo, siempre y en todas partes — y con eso se perderían de golpe el control del
      // hover y la decisión del móvil.
      for (const contentType of ['image/gif', 'image/apng', 'image/png', 'video/mp4']) {
        await pedirPreviewUrl(proToken, previewValido(listing.id, { contentType })).expect(400);
      }
    });

    it('y rechaza un sprite más pesado que el máximo', async () => {
      const listing = await crearAnuncio('peso');
      await pedirPreviewUrl(
        proToken,
        previewValido(listing.id, { sizeBytes: MAX_PREVIEW_BYTES + 1 }),
      ).expect(400);
    });

    it('el tamaño va DENTRO de la firma: subir más de lo declarado lo rechaza el almacenamiento', async () => {
      const listing = await crearAnuncio('peso-firmado');
      const res = await pedirPreviewUrl(proToken, previewValido(listing.id, { sizeBytes: 512 })).expect(201);

      const grande = Buffer.alloc(64 * 1024, 3);
      const put = await fetch(res.body.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/webp', 'Content-Length': String(grande.length) },
        body: grande,
      });
      expect(put.ok).toBe(false);
      expect(await r2.head(res.body.key)).toBeNull();
    });
  });
});
