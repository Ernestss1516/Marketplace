/**
 * HUÉRFANAS SIN FILA — RÁFAGA H2: «LO QUE NUNCA SE CONFIRMA». **Las barreras.**
 *
 * QUÉ CIERRA. Las dos fugas que quedaban tienen la misma forma —un objeto subido esperando
 * una confirmación que puede no llegar—: el vídeo entre firmar y confirmar (hasta 50 MB) y
 * el avatar entre subirlo y guardar el perfil. Ahora los dos **nacen bajo `tmp/`** y sólo
 * salen de ahí al confirmarse; lo que se quede dentro lo caduca una regla de ciclo de vida
 * del bucket.
 *
 * LA MITAD QUE NO SE PUEDE PROBAR AQUÍ, y conviene decirlo antes de leer nada: **la regla no
 * se prueba en CI**. Una caducidad se mide en días y ninguna suite espera un día; además es
 * configuración del bucket, no código (queda documentada en `pendientes.md` §1, paso 7). Lo
 * que este fichero prueba es **la condición que hace segura esa regla**: que lo confirmado
 * NO se queda en `tmp/`. Si esto se rompiera, activar la regla borraría vídeos vivos.
 *
 * SE MIRA EL ALMACENAMIENTO DE VERDAD (`r2.head` contra MinIO), molde de
 * `video-infra.e2e-spec.ts`: aquí lo que se afirma es dónde acaba el objeto, así que espiar
 * llamadas no valdría — el fallo que importa es «se copió pero no donde yo creo».
 *
 * Ver `docs/diseno-huerfanas-sin-fila.md` §9.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { R2Service } from 'src/infra/r2/r2.service';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { MediaCleanupService } from 'src/modules/media-cleanup/media-cleanup.service';
import { VIDEO_KEY_PREFIX, VIDEO_ENABLED_SETTING } from 'src/modules/video/video-limits';

/** Un PNG mínimo válido: lo que importa es el mime, no el contenido. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Huérfanas H2 — lo que se confirma sale de tmp/ (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let r2: R2Service;

  let proToken: string;
  let proId: string;
  let otroToken: string;
  let otroId: string;
  let categoryId: string;

  const server = () => app.getHttpServer();

  /** La clave de una URL pública nuestra. */
  const claveDe = (url: string) => url.slice(r2.getPublicUrl('').length);

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);
    r2 = app.get(R2Service);

    // El vídeo es una feature con interruptor de admin, y sin fila está APAGADA.
    await prisma.setting.upsert({
      where: { key: VIDEO_ENABLED_SETTING },
      create: { key: VIDEO_ENABLED_SETTING, value: true },
      update: { value: true },
    });

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [pro, otro] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'h2-pro@example.com', name: 'H2 Pro', slug: 'h2-pro',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'h2-otro@example.com', name: 'H2 Otro', slug: 'h2-otro',
          passwordHash, emailVerified: true,
        },
      }),
    ]);
    proId = pro.id;
    otroId = otro.id;

    // Pro de verdad: el vídeo es una ventaja del plan, y el guard se comprueba en servidor.
    await prisma.entitlement.create({
      data: {
        userId: proId,
        type: 'PRO_SUBSCRIPTION',
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });

    [proToken, otroToken] = await Promise.all([
      request(server())
        .post('/api/auth/login')
        .send({ email: 'h2-pro@example.com', password: 'Test1234!' })
        .then((r) => r.body.accessToken as string),
      request(server())
        .post('/api/auth/login')
        .send({ email: 'h2-otro@example.com', password: 'Test1234!' })
        .then((r) => r.body.accessToken as string),
    ]);

    categoryId = (
      await prisma.category.create({
        data: { name: 'H2 Cat', slug: `h2-cat-${Date.now()}`, attributeSchema: [] },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 1 — el vídeo
  // ───────────────────────────────────────────────────────────────────────────

  describe('BARRERA 1 — el vídeo confirmado no se queda en tmp/', () => {
    async function crearAnuncio(sufijo: string) {
      return prisma.listing.create({
        data: {
          title: `H2 ${sufijo}`,
          slug: `h2-${sufijo}-${Date.now()}`,
          description: 'x',
          price: 10,
          type: 'PRODUCT',
          status: 'ACTIVE',
          sellerId: proId,
          categoryId,
        },
      });
    }

    /** Firma, sube de verdad contra el almacenamiento, y devuelve la clave TEMPORAL. */
    async function subir(listingId: string): Promise<string> {
      const contenido = Buffer.from('mp4 de prueba');
      const firma = await request(server())
        .post('/api/video/upload-url')
        .set('Authorization', `Bearer ${proToken}`)
        .send({
          listingId,
          contentType: 'video/mp4',
          sizeBytes: contenido.length,
          durationSeconds: 10,
        })
        .expect(201);

      await fetch(firma.body.uploadUrl as string, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(contenido.length) },
        body: contenido,
      });
      return firma.body.key as string;
    }

    const confirmar = (listingId: string, key: string) =>
      request(server())
        .post(`/api/video/listings/${listingId}/confirm`)
        .set('Authorization', `Bearer ${proToken}`)
        .send({ key, durationSeconds: 10 });

    const definitiva = (temporal: string) =>
      temporal.replace(`${VIDEO_KEY_PREFIX}/tmp/`, `${VIDEO_KEY_PREFIX}/`);

    it('se firma DENTRO de tmp/ y al confirmar el objeto acaba FUERA', async () => {
      const listing = await crearAnuncio('mueve');
      const temporal = await subir(listing.id);

      // Antes de confirmar: el objeto vive en tmp/ y nadie lo referencia. Es exactamente lo
      // que la regla de caducidad debe poder borrar.
      expect(temporal.startsWith(`${VIDEO_KEY_PREFIX}/tmp/${listing.id}/`)).toBe(true);
      expect(await r2.head(temporal)).not.toBeNull();

      await confirmar(listing.id, temporal).expect(201);

      // Después: fuera de tmp/, y el temporal ya no está.
      expect(await r2.head(definitiva(temporal))).not.toBeNull();
      expect(await r2.head(temporal)).toBeNull();

      // Y la fila apunta al definitivo. ESTA es la aserción que hace segura la regla: si la
      // URL guardada llevara `tmp/`, activarla borraría un vídeo vivo.
      const guardado = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { videoUrl: true },
      });
      expect(guardado.videoUrl).not.toContain('/tmp/');
      expect(claveDe(guardado.videoUrl!)).toBe(definitiva(temporal));
    });

    it('confirmar DOS VECES es idempotente: no falla y no destruye el vídeo', async () => {
      // La segunda confirmación llega con el temporal ya borrado por la primera. Sin mirar
      // el destino, respondería «no encontramos el vídeo subido» sobre uno perfectamente
      // guardado — y con la comparación de `anterior` mal hecha, borraría el objeto que
      // acaba de confirmar.
      const listing = await crearAnuncio('idempotente');
      const temporal = await subir(listing.id);

      const primera = await confirmar(listing.id, temporal).expect(201);
      const segunda = await confirmar(listing.id, temporal).expect(201);

      expect(segunda.body.videoUrl).toBe(primera.body.videoUrl);
      expect(await r2.head(definitiva(temporal))).not.toBeNull();
    });

    it('si la fila falla DESPUÉS de copiar, la copia se deshace', async () => {
      // El único fallo nuevo que introduce la copia: un objeto en el prefijo DEFINITIVO que
      // nadie referencia y que la regla de caducidad no puede recoger, porque sólo mira
      // `tmp/`. Se compensa borrándolo.
      const listing = await crearAnuncio('compensa');
      const temporal = await subir(listing.id);

      const prismaApp = app.get(PrismaService);
      const spy = jest
        .spyOn(prismaApp.listing, 'update')
        .mockRejectedValueOnce(new Error('fallo al escribir la fila'));

      await confirmar(listing.id, temporal).expect(500);
      spy.mockRestore();

      // Ni rastro en el definitivo…
      expect(await r2.head(definitiva(temporal))).toBeNull();
      // …y el original sigue en tmp/, donde la regla lo caducará: reintentar no pierde nada.
      expect(await r2.head(temporal)).not.toBeNull();

      const guardado = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
        select: { videoUrl: true },
      });
      expect(guardado.videoUrl).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 2 — el avatar (fuga 1b)
  // ───────────────────────────────────────────────────────────────────────────

  describe('BARRERA 2 — el avatar guardado no se queda en tmp/', () => {
    const subirAvatar = (token: string) =>
      request(server())
        .post('/api/media/upload-avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', TINY_PNG, { filename: 'avatar.png', contentType: 'image/png' })
        .expect(201)
        .then((r) => r.body.url as string);

    const guardarPerfil = (token: string, avatarUrl: string) =>
      request(server())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ avatarUrl });

    it('se sube DENTRO de tmp/ (con el userId) y al guardar el perfil acaba FUERA', async () => {
      const temporal = await subirAvatar(proToken);
      expect(claveDe(temporal)).toMatch(new RegExp(`^avatars/tmp/${proId}/`));
      expect(await r2.head(claveDe(temporal))).not.toBeNull();

      const res = await guardarPerfil(proToken, temporal).expect(200);

      expect(res.body.avatarUrl).not.toContain('/tmp/');
      expect(await r2.head(claveDe(res.body.avatarUrl as string))).not.toBeNull();
      expect(await r2.head(claveDe(temporal))).toBeNull();

      const guardado = await prisma.user.findUniqueOrThrow({
        where: { id: proId },
        select: { avatarUrl: true },
      });
      expect(guardado.avatarUrl).toBe(res.body.avatarUrl);
    });

    it('la temporal de OTRO usuario se rechaza', async () => {
      // El `userId` va en la clave justamente para esto, y hace falta: `avatarUrl` es un
      // `@IsString()` pelado, así que sin esta comprobación cualquiera podría confirmar —y
      // por tanto mover a su perfil— la foto que otro acaba de subir.
      const ajena = await subirAvatar(otroToken);
      await guardarPerfil(proToken, ajena).expect(403);

      // Y la de la víctima sigue intacta, esperando su propio guardado.
      expect(await r2.head(claveDe(ajena))).not.toBeNull();
    });

    it('guardar DOS VECES la misma URL temporal es idempotente', async () => {
      const temporal = await subirAvatar(otroToken);
      const primera = await guardarPerfil(otroToken, temporal).expect(200);
      const segunda = await guardarPerfil(otroToken, temporal).expect(200);

      expect(segunda.body.avatarUrl).toBe(primera.body.avatarUrl);
      expect(await r2.head(claveDe(primera.body.avatarUrl as string))).not.toBeNull();
    });

    it('una URL ajena (Google) se guarda tal cual, sin tocar el almacenamiento', async () => {
      const google = 'https://lh3.googleusercontent.com/a/h2-foto';
      const res = await guardarPerfil(otroToken, google).expect(200);
      expect(res.body.avatarUrl).toBe(google);
    });

    it('H1 sigue en pie: al sustituir, lo que se encola es el avatar DEFINITIVO viejo', async () => {
      // El diff de H1 compara contra la URL ya definitiva, así que una temporal no entra
      // nunca en él. Si entrara, se encolaría para borrar la clave que acaba de copiarse.
      const cola = (
        app.get(MediaCleanupService) as unknown as { mediaCleanupQueue: { add: unknown } }
      ).mediaCleanupQueue;
      const addSpy = jest.spyOn(cola as never, 'add').mockResolvedValue({} as never);

      const anterior = await prisma.user
        .findUniqueOrThrow({ where: { id: proId }, select: { avatarUrl: true } })
        .then((u) => u.avatarUrl!);

      const temporal = await subirAvatar(proToken);
      const res = await guardarPerfil(proToken, temporal).expect(200);

      const purgas = addSpy.mock.calls.filter((c) => c[0] === 'purge');
      expect(purgas).toHaveLength(1);
      const keys = (purgas[0][1] as { keys: string[] }).keys;
      expect(keys).toEqual([claveDe(anterior)]);
      // Ni la temporal ni la nueva definitiva se encolan jamás.
      expect(keys).not.toContain(claveDe(temporal));
      expect(keys).not.toContain(claveDe(res.body.avatarUrl as string));

      addSpy.mockRestore();
    });
  });
});
