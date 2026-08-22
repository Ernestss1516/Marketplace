/**
 * Vídeo Pro, ráfaga 1 — LA INFRAESTRUCTURA (e2e).
 *
 * Se prueba entera sin una sola pantalla, que es la razón de que esta ráfaga vaya sola y
 * primera: aquí están las decisiones caras de revertir (almacenamiento, límites, no
 * transcodificar) y conviene saber si son correctas antes de construir nada encima.
 *
 * LA PRUEBA CENTRAL es que el fichero viaja del cliente al almacenamiento SIN PASAR POR LA
 * API: se firma una URL, se hace el PUT contra ella y se comprueba que el objeto existe. Y
 * la segunda, que el tamaño no depende de que el cliente diga la verdad — porque va dentro
 * de la firma.
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { R2Service } from 'src/infra/r2/r2.service';
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  VIDEO_ENABLED_SETTING,
  VIDEO_KEY_PREFIX,
} from 'src/modules/video/video-limits';
import { isOwnStorageUrl } from 'src/common/validators/safe-url';

describe('Vídeo Pro — infraestructura (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let r2: R2Service;

  let proToken: string;
  let freeToken: string;
  let proUserId: string;
  let freeUserId: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    r2 = app.get(R2Service);

    categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } })).id;
    const hash = await bcrypt.hash('Test1234!', 4);

    const pro = await prisma.user.create({
      data: { email: 'video-pro@example.com', name: 'Pro', slug: 'video-pro', passwordHash: hash, emailVerified: true },
    });
    proUserId = pro.id;
    const free = await prisma.user.create({
      data: { email: 'video-free@example.com', name: 'Free', slug: 'video-free', passwordHash: hash, emailVerified: true },
    });
    freeUserId = free.id;

    await hacerPro(proUserId);
    proToken = await login('video-pro@example.com');
    freeToken = await login('video-free@example.com');

    await encender(true);
  });

  afterAll(async () => {
    await encender(false);
    await app.close();
    await prisma.$disconnect();
  });

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
        gatewaySubscriptionId: `sub_video_${userId}`,
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

  async function crearAnuncio(
    suffix: string,
    sellerId = proUserId,
    status: ListingStatus = ListingStatus.ACTIVE,
  ) {
    return prisma.listing.create({
      data: {
        title: `Vídeo ${suffix}`,
        slug: `video-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: 'Anuncio para la infraestructura de vídeo',
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

  const pedirUrl = (token: string, body: object) =>
    request(app.getHttpServer())
      .post('/api/video/upload-url')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const cuerpoValido = (listingId: string, over: Record<string, unknown> = {}) => ({
    listingId,
    contentType: 'video/mp4',
    sizeBytes: 1024,
    durationSeconds: 30,
    ...over,
  });

  // ── 1. Los bytes NO pasan por la API ───────────────────────────────────────

  describe('la subida va directa del cliente al almacenamiento', () => {
    it('firma una URL, el PUT sube el objeto, y la API nunca ve el fichero', async () => {
      const listing = await crearAnuncio('directa');
      const contenido = Buffer.from('no es un mp4 de verdad, pero pesa lo que dice');

      const res = await pedirUrl(proToken, cuerpoValido(listing.id, { sizeBytes: contenido.length })).expect(201);

      expect(res.body.uploadUrl).toContain(VIDEO_KEY_PREFIX);
      // HUÉRFANAS H2 — se firma contra el prefijo TEMPORAL; el definitivo se gana al
      // confirmar. Ver `huerfanas-h2.e2e-spec.ts`.
      expect(res.body.key).toContain(`${VIDEO_KEY_PREFIX}/tmp/${listing.id}/`);
      expect(res.body.requiredHeaders['Content-Type']).toBe('video/mp4');

      // EL PUT VA CONTRA EL ALMACENAMIENTO, no contra la API: ni una ruta de este servidor
      // interviene, que es justo lo que elimina el riesgo de RAM del camino de imágenes.
      const put = await fetch(res.body.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(contenido.length) },
        body: contenido,
      });
      expect(put.ok).toBe(true);

      // Y el objeto está ahí, con el tamaño que se declaró.
      const objeto = await r2.head(res.body.key);
      expect(objeto?.contentLength).toBe(contenido.length);
    });

    it('el TAMAÑO va dentro de la firma: subir más de lo declarado es rechazado', async () => {
      const listing = await crearAnuncio('tamano-firmado');

      // Se declara 1 KB…
      const res = await pedirUrl(proToken, cuerpoValido(listing.id, { sizeBytes: 1024 })).expect(201);

      // …y se intenta colar 1 MB por la misma URL.
      const grande = Buffer.alloc(1024 * 1024, 1);
      const put = await fetch(res.body.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(grande.length) },
        body: grande,
      });

      // Lo rechaza el ALMACENAMIENTO, no la API: por eso el límite es una garantía y no una
      // comprobación que dependa de que el cliente sea honesto.
      expect(put.ok).toBe(false);
      expect(await r2.head(res.body.key)).toBeNull();
    });
  });

  // ── 2. Los límites, en el servidor ─────────────────────────────────────────

  describe('los límites se aplican antes de firmar', () => {
    it('rechaza un vídeo más pesado que el máximo', async () => {
      const listing = await crearAnuncio('pesado');
      await pedirUrl(proToken, cuerpoValido(listing.id, { sizeBytes: MAX_VIDEO_BYTES + 1 })).expect(400);
    });

    it('rechaza uno más largo que el máximo', async () => {
      const listing = await crearAnuncio('largo');
      await pedirUrl(
        proToken,
        cuerpoValido(listing.id, { durationSeconds: MAX_VIDEO_DURATION_SECONDS + 1 }),
      ).expect(400);
    });

    it('rechaza un formato que no sea MP4 — es lo que permite no transcodificar', async () => {
      const listing = await crearAnuncio('formato');
      for (const contentType of ['video/webm', 'video/quicktime', 'image/jpeg']) {
        await pedirUrl(proToken, cuerpoValido(listing.id, { contentType })).expect(400);
      }
    });

    it('y acepta uno que cumple los tres', async () => {
      const listing = await crearAnuncio('valido');
      await pedirUrl(
        proToken,
        cuerpoValido(listing.id, { sizeBytes: MAX_VIDEO_BYTES, durationSeconds: MAX_VIDEO_DURATION_SECONDS }),
      ).expect(201);
    });
  });

  // ── 3. Los gates ───────────────────────────────────────────────────────────

  describe('quién puede subir', () => {
    it('un NO-Pro no puede, aunque llame directamente a la API', async () => {
      const listing = await crearAnuncio('no-pro', freeUserId);
      // Esconder la sección en el editor no protegería de esto.
      const res = await pedirUrl(freeToken, cuerpoValido(listing.id)).expect(403);
      expect(res.body.code).toBe('PRO_REQUIRED');
    });

    it('ni un Pro sobre el anuncio de otro', async () => {
      const ajeno = await crearAnuncio('ajeno', freeUserId);
      await pedirUrl(proToken, cuerpoValido(ajeno.id)).expect(403);
    });

    it('ni sobre un anuncio que no está activo', async () => {
      const vendido = await crearAnuncio('vendido', proUserId, ListingStatus.SOLD);
      await pedirUrl(proToken, cuerpoValido(vendido.id)).expect(400);
    });

    it('con la feature APAGADA no puede nadie, ni siendo Pro', async () => {
      const listing = await crearAnuncio('apagada');
      await encender(false);
      try {
        const res = await pedirUrl(proToken, cuerpoValido(listing.id)).expect(400);
        expect(res.body.code).toBe('VIDEO_DISABLED');
      } finally {
        await encender(true);
      }
    });

    it('sin ajuste sembrado, la feature está APAGADA: encenderla es un acto explícito', async () => {
      const listing = await crearAnuncio('sin-ajuste');
      await prisma.setting.delete({ where: { key: VIDEO_ENABLED_SETTING } }).catch(() => undefined);
      try {
        await pedirUrl(proToken, cuerpoValido(listing.id)).expect(400);
      } finally {
        await encender(true);
      }
    });
  });

  // ── 4. Confirmar ───────────────────────────────────────────────────────────

  describe('confirmar la subida', () => {
    /** La clave donde el vídeo acaba tras confirmarse: la misma, sin el `tmp/` (H2). */
    const claveDefinitiva = (temporal: string) =>
      temporal.replace(`${VIDEO_KEY_PREFIX}/tmp/`, `${VIDEO_KEY_PREFIX}/`);

    async function subirDeVerdad(listingId: string) {
      const contenido = Buffer.from('mp4 de prueba');
      const res = await pedirUrl(proToken, cuerpoValido(listingId, { sizeBytes: contenido.length })).expect(201);
      await fetch(res.body.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(contenido.length) },
        body: contenido,
      });
      return res.body.key as string;
    }

    const confirmar = (listingId: string, body: object) =>
      request(app.getHttpServer())
        .post(`/api/video/listings/${listingId}/confirm`)
        .set('Authorization', `Bearer ${proToken}`)
        .send(body);

    it('enlaza el vídeo al anuncio y deja hasVideo derivable de la URL', async () => {
      const listing = await crearAnuncio('confirma');
      const key = await subirDeVerdad(listing.id);

      const res = await confirmar(listing.id, { key, durationSeconds: 42 }).expect(201);
      expect(res.body.hasVideo).toBe(true);

      const guardado = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { videoUrl: true, videoDurationSeconds: true, videoUploadedAt: true },
      });
      expect(guardado.videoUrl).not.toBeNull();
      expect(guardado.videoDurationSeconds).toBe(42);
      expect(guardado.videoUploadedAt).not.toBeNull();
      // La URL es de NUESTRO almacenamiento — el <video> no tiene otra protección de origen.
      expect(isOwnStorageUrl(guardado.videoUrl!)).toBe(true);
    });

    it('no se puede confirmar un objeto que nunca se subió', async () => {
      const listing = await crearAnuncio('fantasma');
      // Clave con la forma correcta (temporal, de ESTE anuncio) para que el 400 venga de
      // que el objeto no existe y no de la comprobación de pertenencia.
      await confirmar(listing.id, {
        key: `${VIDEO_KEY_PREFIX}/tmp/${listing.id}/no-existe.mp4`,
        durationSeconds: 10,
      }).expect(400);
    });

    it('ni una clave de OTRO anuncio', async () => {
      const [a, b] = await Promise.all([crearAnuncio('clave-a'), crearAnuncio('clave-b')]);
      const key = await subirDeVerdad(a.id);

      // Confirmar en B un objeto subido para A dejaría enlazar contenido cruzado.
      await confirmar(b.id, { key, durationSeconds: 10 }).expect(400);
    });

    it('rechaza un póster que no venga de nuestro almacenamiento', async () => {
      const listing = await crearAnuncio('poster-ajeno');
      const key = await subirDeVerdad(listing.id);

      await confirmar(listing.id, {
        key,
        durationSeconds: 10,
        posterUrl: 'https://atacante.example.com/poster.jpg',
      }).expect(400);
    });

    it('sustituir el vídeo borra el anterior del almacenamiento', async () => {
      const listing = await crearAnuncio('sustituye');
      const primera = await subirDeVerdad(listing.id);
      await confirmar(listing.id, { key: primera, durationSeconds: 10 }).expect(201);

      const segunda = await subirDeVerdad(listing.id);
      await confirmar(listing.id, { key: segunda, durationSeconds: 10 }).expect(201);

      // Un vídeo por anuncio: el viejo ya no se puede ver, así que no debe seguir ocupando.
      //
      // SE MIRAN LAS CLAVES DEFINITIVAS (H2), no las temporales: desde que confirmar copia
      // el objeto fuera de `tmp/`, la temporal está vacía SIEMPRE —la borra la propia
      // confirmación—, así que preguntar por ella daría verde sin probar nada.
      expect(await r2.head(claveDefinitiva(primera))).toBeNull();
      expect(await r2.head(claveDefinitiva(segunda))).not.toBeNull();
    });

    it('quitar el vídeo lo desenlaza y lo borra', async () => {
      const listing = await crearAnuncio('quitar');
      const key = await subirDeVerdad(listing.id);
      await confirmar(listing.id, { key, durationSeconds: 10 }).expect(201);

      await request(app.getHttpServer())
        .delete(`/api/video/listings/${listing.id}`)
        .set('Authorization', `Bearer ${proToken}`)
        .expect(200);

      const guardado = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { videoUrl: true, videoPosterUrl: true, videoDurationSeconds: true },
      });
      expect(guardado.videoUrl).toBeNull();
      expect(guardado.videoPosterUrl).toBeNull();
      expect(guardado.videoDurationSeconds).toBeNull();
      // La definitiva, por lo mismo que arriba: la temporal ya no existe desde que se
      // confirmó, así que preguntar por ella no probaría que quitar borra nada.
      expect(await r2.head(claveDefinitiva(key))).toBeNull();
    });
  });

  // ── 5. Los límites publicados ──────────────────────────────────────────────

  it('la API publica su configuración para que el cliente valide antes de subir 50 MB en balde', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/video/config')
      .set('Authorization', `Bearer ${proToken}`)
      .expect(200);

    expect(res.body).toEqual({
      // `enabled` viaja con los límites para que el editor no tenga que preguntar en otro
      // sitio si la sección existe. Es el MISMO guard que se aplica al firmar, así que
      // interfaz y servidor no pueden discrepar.
      enabled: true,
      maxBytes: MAX_VIDEO_BYTES,
      maxDurationSeconds: MAX_VIDEO_DURATION_SECONDS,
      allowedMimeTypes: ['video/mp4'],
    });
  });

  it('y con la feature apagada lo dice, en vez de dejar al editor adivinar', async () => {
    await encender(false);
    try {
      const res = await request(app.getHttpServer())
        .get('/api/video/config')
        .set('Authorization', `Bearer ${proToken}`)
        .expect(200);
      expect(res.body.enabled).toBe(false);
    } finally {
      await encender(true);
    }
  });

  // ── 6. Requisito de oro ────────────────────────────────────────────────────

  it('REQUISITO DE ORO — la subida de IMÁGENES sigue intacta', async () => {
    // El camino de imágenes no se ha tocado: mismo endpoint, mismo multipart, mismos MIME.
    const res = await request(app.getHttpServer())
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${proToken}`)
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]), {
        filename: 'foto.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    expect(res.body.url).toBeDefined();
    expect(isOwnStorageUrl(res.body.url)).toBe(true);
  });
});
