/**
 * VÍDEO DE BLOQUE — RÁFAGA V1: EL MECANISMO Y EL MODELO. **Las barreras.**
 *
 * QUÉ SE PRUEBA AQUÍ Y NO EN OTRO SITIO: **dónde acaba el objeto**. Espiar llamadas no
 * valdría —el fallo que importa es «se copió, pero no donde yo creo»—, así que esto habla
 * con el almacenamiento de verdad (`r2.head` contra MinIO). Molde de
 * `huerfanas-h2.e2e-spec.ts` y `video-infra.e2e-spec.ts`.
 *
 * LA BARRERA QUE SOSTIENE TODAS LAS DEMÁS es B-2: **nunca se persiste una URL bajo `tmp/`**.
 * Si se rompiera, la regla de ciclo de vida del bucket borraría a las 24 h un vídeo ya
 * publicado, y el fallo sería invisible hasta ese momento. Por eso el pase de promoción es
 * fail-closed: antes que guardar una temporal, que se caiga el guardado.
 *
 * LO QUE NO SE PUEDE PROBAR AQUÍ, igual que en H2: que un objeto abandonado en `tmp/`
 * desaparezca solo. Depende de una regla configurada en el bucket y se mide en días
 * (`pendientes.md` §1, paso 7). Lo que sí se prueba es la condición que la hace segura.
 *
 * Ver `docs/diseno-video-bloque.md` §4, §9 y §10.
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
import { BLOCK_MEDIA_KEY_PREFIX } from 'src/modules/block-media/block-media-limits';

/** Un WebP mínimo: para el póster lo que importa es el mime, no el contenido. */
const TINY_WEBP = Buffer.from(
  'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
  'base64',
);

describe('Vídeo de bloque V1 — el mecanismo (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let r2: R2Service;

  let adminToken: string;
  let editorToken: string;
  let editorId: string;
  let otroEditorToken: string;
  let userToken: string;

  const server = () => app.getHttpServer();

  /** La clave de una URL pública nuestra. */
  const claveDe = (url: string) => url.slice(r2.getPublicUrl('').length);

  async function crearStaff(email: string, role: 'ADMIN' | 'EDITOR' | 'USER') {
    const user = await prisma.user.create({
      data: {
        email,
        name: email,
        slug: email.replace(/[^a-z0-9]/g, '-'),
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
        role,
      },
    });
    // El staff entra por `admin-login`; un USER normal, por el login de siempre.
    const ruta = role === 'USER' ? '/api/auth/login' : '/api/auth/admin-login';
    const res = await request(server()).post(ruta).send({ email, password: 'Test1234!' });
    return { id: user.id, token: res.body.accessToken as string };
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    r2 = app.get(R2Service);

    // EN SERIE, Y NO ES ESTILO — es la corrección de un rojo real (CI de `main`, corrida
    // 33507515406, `connect ECONNRESET`). Estos cuatro logins eran el PRIMER tráfico HTTP
    // de la suite y salían en un `Promise.all`: supertest, cuando el servidor todavía no
    // escucha, hace `listen(0)` por su cuenta, así que cuatro peticiones simultáneas contra
    // un servidor frío compiten por abrir el puerto y alguna se lleva un reset. Es una
    // carrera, así que verde en una corrida y rojo en la siguiente con el mismo código.
    //
    // La primera petición deja el servidor escuchando y las demás ya lo encuentran abierto.
    // En serie cuestan cuatro viajes en local (~40 ms) y quitan la carrera entera.
    const admin = await crearStaff('vb-admin@example.com', 'ADMIN');
    const editor = await crearStaff('vb-editor@example.com', 'EDITOR');
    const otro = await crearStaff('vb-otro@example.com', 'EDITOR');
    const normal = await crearStaff('vb-user@example.com', 'USER');

    adminToken = admin.token;
    editorToken = editor.token;
    editorId = editor.id;
    otroEditorToken = otro.token;
    userToken = normal.token;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Utilidades: la coreografía completa firmar → PUT directo → confirmar
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Sube de verdad, con el PUT del «navegador» contra el almacenamiento. Devuelve la URL
   * TEMPORAL, que es lo que el editor guardará en el bloque hasta que alguien pulse guardar.
   */
  async function subir(
    token: string,
    tipo: 'video' | 'poster' = 'video',
  ): Promise<{ url: string; key: string }> {
    const esVideo = tipo === 'video';
    const contenido = esVideo ? Buffer.from('mp4 de prueba') : TINY_WEBP;
    const contentType = esVideo ? 'video/mp4' : 'image/webp';

    const firma = await request(server())
      .post(`/api/admin/block-media/${esVideo ? 'video' : 'poster'}-url`)
      .set('Authorization', `Bearer ${token}`)
      .send({ contentType, sizeBytes: contenido.length })
      .expect(201);

    // EL PUT NO PASA POR LA API: va directo al almacenamiento con la URL prefirmada.
    const puesto = await fetch(firma.body.uploadUrl as string, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, 'Content-Length': String(contenido.length) },
      body: contenido,
    });
    expect(puesto.ok).toBe(true);

    const confirmado = await request(server())
      .post('/api/admin/block-media/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: firma.body.key })
      .expect(200);

    return { url: confirmado.body.url as string, key: firma.body.key as string };
  }

  const bloqueVideo = (url: string, extra: Record<string, unknown> = {}) => ({
    id: `b-${Math.random().toString(36).slice(2, 10)}`,
    type: 'videoUpload',
    url,
    ...extra,
  });

  const crearPost = (token: string, title: string, blocks: unknown[]) =>
    request(server())
      .post('/api/admin/blog')
      .set('Authorization', `Bearer ${token}`)
      .send({ title, blocks });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA B-1 — los bytes no pasan por la API
  // ───────────────────────────────────────────────────────────────────────────

  describe('B-1 — los bytes no pasan por la API', () => {
    it('no hay ruta de subida: el endpoint sólo acepta JSON y devuelve un permiso', async () => {
      // La mutación que esta barrera mata es «añadir un FileInterceptor para simplificar el
      // editor». Si alguien lo hiciera, un multipart con un fichero sería aceptado aquí y
      // los 50 MB acabarían en la RAM del proceso que atiende toda la API.
      await request(server())
        .post('/api/admin/block-media/video-url')
        .set('Authorization', `Bearer ${editorToken}`)
        .attach('file', Buffer.from('mp4 de prueba'), {
          filename: 'v.mp4',
          contentType: 'video/mp4',
        })
        .expect(400);
    });

    it('el fichero llega al almacenamiento sin que la API lo haya visto', async () => {
      const { key } = await subir(editorToken);
      // Existe en el bucket, y lo único que la API recibió fueron dos cuerpos JSON.
      expect(await r2.head(key)).not.toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // El gate
  // ───────────────────────────────────────────────────────────────────────────

  describe('El gate — EDITOR o superior', () => {
    it('un USER normal no firma', async () => {
      await request(server())
        .post('/api/admin/block-media/video-url')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ contentType: 'video/mp4', sizeBytes: 1000 })
        .expect(403);
    });

    it('sin token, tampoco', async () => {
      await request(server())
        .post('/api/admin/block-media/video-url')
        .send({ contentType: 'video/mp4', sizeBytes: 1000 })
        .expect(401);
    });

    it('un EDITOR sí', async () => {
      await request(server())
        .post('/api/admin/block-media/video-url')
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ contentType: 'video/mp4', sizeBytes: 1000 })
        .expect(201);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Los límites
  // ───────────────────────────────────────────────────────────────────────────

  describe('Los límites — 50 MB y sólo MP4, sin duración', () => {
    const firmar = (body: Record<string, unknown>) =>
      request(server())
        .post('/api/admin/block-media/video-url')
        .set('Authorization', `Bearer ${editorToken}`)
        .send(body);

    it('rechaza lo que no es MP4', async () => {
      await firmar({ contentType: 'video/webm', sizeBytes: 1000 }).expect(400);
    });

    it('rechaza lo que pasa de 50 MB', async () => {
      await firmar({ contentType: 'video/mp4', sizeBytes: 51 * 1024 * 1024 }).expect(400);
    });

    it('NO hay duración en el contrato: se firma sin ella, y mandarla se rechaza', async () => {
      // La ausencia es la decisión (`block-media-limits.ts`): el servidor no puede
      // comprobar la duración sin ffmpeg, así que el vídeo Pro valida la DECLARADA por el
      // cliente — un límite de producto que se puede esquivar. Aquí no se finge: no existe
      // el campo. El daño ya lo acota el tamaño, que sí viaja dentro de la firma.
      await firmar({ contentType: 'video/mp4', sizeBytes: 49 * 1024 * 1024 }).expect(201);
      await firmar({ contentType: 'video/mp4', sizeBytes: 1000, durationSeconds: 6000 }).expect(400);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA B-4 — el confirm NO copia
  // ───────────────────────────────────────────────────────────────────────────

  describe('B-4 — el confirm no mueve nada', () => {
    it('tras confirmar, el objeto SIGUE en tmp/ y la URL devuelta también', async () => {
      // Ésta es la diferencia central con el vídeo Pro. Si el confirm sacara el objeto de
      // `tmp/`, un editor que sube y cierra la pestaña sin guardar dejaría 50 MB fuera del
      // alcance de la regla de caducidad: una huérfana PERMANENTE, y en el caso de abandono
      // más común que hay.
      const { url, key } = await subir(editorToken);

      expect(key.startsWith(`${BLOCK_MEDIA_KEY_PREFIX}/tmp/${editorId}/`)).toBe(true);
      expect(url).toContain('/tmp/');
      expect(await r2.head(key)).not.toBeNull();

      // Y no hay nada en el destino todavía: la copia es al guardar.
      const definitiva = key.replace(`${BLOCK_MEDIA_KEY_PREFIX}/tmp/${editorId}/`, `${BLOCK_MEDIA_KEY_PREFIX}/`);
      expect(await r2.head(definitiva)).toBeNull();
    });

    it('confirmar dos veces no rompe: como no mueve nada, es idempotente de balde', async () => {
      const { key } = await subir(editorToken);
      const segunda = await request(server())
        .post('/api/admin/block-media/confirm')
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ key })
        .expect(200);
      expect(claveDe(segunda.body.url as string)).toBe(key);
    });

    it('confirmar la subida de OTRO se rechaza', async () => {
      const ajena = await subir(otroEditorToken);
      await request(server())
        .post('/api/admin/block-media/confirm')
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ key: ajena.key })
        .expect(403);
    });

    it('confirmar algo que nunca se subió se rechaza', async () => {
      await request(server())
        .post('/api/admin/block-media/confirm')
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ key: `${BLOCK_MEDIA_KEY_PREFIX}/tmp/${editorId}/no-existe.mp4` })
        .expect(400);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA B-2 — la promoción al guardar, y el fail-closed
  // ───────────────────────────────────────────────────────────────────────────

  describe('B-2 — guardar promociona, y NUNCA persiste un tmp/', () => {
    it('al crear el post, el vídeo sale de tmp/ y lo guardado apunta al definitivo', async () => {
      const { url, key } = await subir(editorToken);

      const res = await crearPost(editorToken, 'Post con vídeo', [bloqueVideo(url)]).expect(201);

      const guardada = res.body.blocks[0].url as string;
      // LA ASERCIÓN QUE HACE SEGURA LA REGLA DE CICLO DE VIDA.
      expect(guardada).not.toContain('/tmp/');
      expect(claveDe(guardada)).toBe(`${BLOCK_MEDIA_KEY_PREFIX}/${key.split('/').pop()}`);

      // El objeto está donde dice la fila, y el temporal ya no está.
      expect(await r2.head(claveDe(guardada))).not.toBeNull();
      expect(await r2.head(key)).toBeNull();

      // Y lo que hay en la BD es lo mismo que se devolvió: nada se queda a medias.
      const enBd = await prisma.post.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(JSON.stringify(enBd.blocks)).not.toContain('/tmp/');
    });

    it('el PÓSTER viaja por el mismo pase, sin una línea extra', async () => {
      // El pase recorre el `Json` entero, no una lista de campos: el póster se promociona
      // porque está ahí dentro, no porque nadie lo haya enumerado.
      const video = await subir(editorToken, 'video');
      const poster = await subir(editorToken, 'poster');

      const res = await crearPost(editorToken, 'Post con póster', [
        bloqueVideo(video.url, { poster: poster.url, caption: 'Un pie' }),
      ]).expect(201);

      const bloque = res.body.blocks[0];
      expect(bloque.url).not.toContain('/tmp/');
      expect(bloque.poster).not.toContain('/tmp/');
      expect(bloque.caption).toBe('Un pie');
      expect(await r2.head(claveDe(bloque.poster as string))).not.toBeNull();
      expect(await r2.head(poster.key)).toBeNull();
    });

    it('al EDITAR también: un vídeo añadido después sale de tmp/', async () => {
      const creado = await crearPost(editorToken, 'Post que crece', []).expect(201);
      const { url, key } = await subir(editorToken);

      const res = await request(server())
        .patch(`/api/admin/blog/${creado.body.id}`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ blocks: [bloqueVideo(url)] })
        .expect(200);

      expect(res.body.blocks[0].url).not.toContain('/tmp/');
      expect(await r2.head(key)).toBeNull();
    });

    it('FAIL-CLOSED: si el fichero ya no está, el guardado FALLA y no se crea nada', async () => {
      // El caso real: una sesión de edición que dura más que la regla de caducidad, o una
      // URL temporal inventada. Guardar el enlace en silencio sería dejar un bloque roto —
      // o peor, uno que la regla se lleva por delante más tarde.
      const inventada = r2.getPublicUrl(`${BLOCK_MEDIA_KEY_PREFIX}/tmp/${editorId}/fantasma.mp4`);

      await crearPost(editorToken, 'Post fantasma', [bloqueVideo(inventada)]).expect(400);

      expect(await prisma.post.findFirst({ where: { title: 'Post fantasma' } })).toBeNull();
    });

    it('FAIL-CLOSED: la temporal de OTRO editor no se puede adoptar al guardar', async () => {
      // El `<userId>` va en la clave justamente para esto. Sin la comprobación, cualquier
      // EDITOR podría pegar en su post la URL que otro acaba de subir.
      const ajena = await subir(otroEditorToken);

      await crearPost(editorToken, 'Post ajeno', [bloqueVideo(ajena.url)]).expect(403);

      expect(await prisma.post.findFirst({ where: { title: 'Post ajeno' } })).toBeNull();
      // Y la del otro sigue intacta, esperando su propio guardado.
      expect(await r2.head(ajena.key)).not.toBeNull();
    });

    it('COMPENSACIÓN: si la fila falla tras copiar, la copia se deshace', async () => {
      // El único fallo nuevo que introduce la copia: un objeto en el prefijo DEFINITIVO que
      // nadie referencia y que la regla de caducidad no puede recoger, porque sólo mira
      // `tmp/`. Sin compensar, sería una huérfana permanente.
      const { key } = await subir(editorToken);
      const url = r2.getPublicUrl(key);
      const definitiva = key.replace(`${BLOCK_MEDIA_KEY_PREFIX}/tmp/${editorId}/`, `${BLOCK_MEDIA_KEY_PREFIX}/`);

      const prismaApp = app.get(PrismaService);
      const spy = jest
        .spyOn(prismaApp.post, 'create')
        .mockRejectedValueOnce(new Error('fallo al escribir la fila'));

      await crearPost(editorToken, 'Post que no cuaja', [bloqueVideo(url)]).expect(500);
      spy.mockRestore();

      // Ni rastro en el definitivo…
      expect(await r2.head(definitiva)).toBeNull();
      // …y el original sigue en tmp/, donde la regla lo caducará: reintentar no pierde nada.
      expect(await r2.head(key)).not.toBeNull();
    });

    it('guardar de nuevo un post ya guardado no vuelve a copiar ni rompe', async () => {
      // Idempotencia: las URLs ya son definitivas, así que el pase no encuentra candidatas
      // y sale por su atajo sin tocar el almacenamiento.
      const { url } = await subir(editorToken);
      const creado = await crearPost(editorToken, 'Post estable', [bloqueVideo(url)]).expect(201);
      const guardada = creado.body.blocks[0].url as string;

      const res = await request(server())
        .patch(`/api/admin/blog/${creado.body.id}`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ blocks: creado.body.blocks, title: 'Post estable II' })
        .expect(200);

      expect(res.body.blocks[0].url).toBe(guardada);
      expect(await r2.head(claveDe(guardada))).not.toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA B-3 — la URL literal, y la limpieza que ya existía
  // ───────────────────────────────────────────────────────────────────────────

  describe('B-3 — la URL literal en el Json hace que la limpieza de H1 lo vea', () => {
    /** Espía la cola de limpieza, molde `huerfanas-h2.e2e-spec.ts`. */
    function espiarCola() {
      const cola = (
        app.get(MediaCleanupService) as unknown as { mediaCleanupQueue: { add: unknown } }
      ).mediaCleanupQueue;
      return jest.spyOn(cola as never, 'add').mockResolvedValue({} as never);
    }

    const clavesEncoladas = (spy: jest.SpyInstance) =>
      spy.mock.calls
        .filter((c) => c[0] === 'purge')
        .flatMap((c) => (c[1] as { keys: string[] }).keys);

    it('quitar el bloque de un post encola el borrado del vídeo', async () => {
      // Esto sale GRATIS: `ownUrlsDeep` recorre el valor entero y no enumera campos, así
      // que un tipo de bloque nuevo entra en la limpieza sin tocar una línea de H1. La
      // mutación que lo mata es guardar aquí la clave en vez de la URL: el recorrido se
      // quedaría ciego y la huérfana aparecería EN SILENCIO.
      const { url } = await subir(editorToken);
      const creado = await crearPost(editorToken, 'Post que pierde el vídeo', [
        bloqueVideo(url),
      ]).expect(201);
      const guardada = creado.body.blocks[0].url as string;

      const spy = espiarCola();
      await request(server())
        .patch(`/api/admin/blog/${creado.body.id}`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ blocks: [] })
        .expect(200);

      expect(clavesEncoladas(spy)).toEqual([claveDe(guardada)]);
      spy.mockRestore();
    });

    it('borrar el post entero encola el vídeo y su póster', async () => {
      const video = await subir(editorToken, 'video');
      const poster = await subir(editorToken, 'poster');
      const creado = await crearPost(editorToken, 'Post que se borra', [
        bloqueVideo(video.url, { poster: poster.url }),
      ]).expect(201);
      const bloque = creado.body.blocks[0];

      const spy = espiarCola();
      await request(server())
        .delete(`/api/admin/blog/${creado.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      expect(clavesEncoladas(spy).sort()).toEqual(
        [claveDe(bloque.url as string), claveDe(bloque.poster as string)].sort(),
      );
      spy.mockRestore();
    });

    it('el mismo vídeo en DOS bloques y se quita uno: no se encola nada', async () => {
      const { url } = await subir(editorToken);
      const creado = await crearPost(editorToken, 'Post con vídeo repetido', [
        bloqueVideo(url),
        bloqueVideo(url),
      ]).expect(201);

      const spy = espiarCola();
      await request(server())
        .patch(`/api/admin/blog/${creado.body.id}`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ blocks: [creado.body.blocks[0]] })
        .expect(200);

      expect(clavesEncoladas(spy)).toEqual([]);
      spy.mockRestore();
    });

    it('sin falso positivo: la comprobación de dueño no protege un vídeo que ya no usa nadie', async () => {
      // `laReferenciaAlguienMas` consulta ListingImage, avatares, patrocinados, facturas,
      // adjuntos, los dos Json y el vídeo de anuncio. Un `blocks-videos/…` no cae en
      // ninguna de esas salvo en los Json, que es justo lo que debe protegerlo — y cuando
      // sale de todos, se encola.
      const { url } = await subir(editorToken);
      const creado = await crearPost(editorToken, 'Post sin dueños extra', [
        bloqueVideo(url),
      ]).expect(201);
      const guardada = creado.body.blocks[0].url as string;

      const spy = espiarCola();
      await request(server())
        .patch(`/api/admin/blog/${creado.body.id}`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ blocks: [] })
        .expect(200);

      expect(clavesEncoladas(spy)).toContain(claveDe(guardada));
      spy.mockRestore();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Los tres contextos, y la convivencia con el embed
  // ───────────────────────────────────────────────────────────────────────────

  describe('Los tres contextos y la convivencia con el embed', () => {
    it('una PÁGINA acepta el tipo igual que un post (mismo motor)', async () => {
      const { url } = await subir(editorToken);
      const res = await request(server())
        .post('/api/admin/blog')
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ title: 'Página con vídeo', type: 'PAGE', blocks: [bloqueVideo(url)] })
        .expect(201);

      expect(res.body.type).toBe('PAGE');
      expect(res.body.blocks[0].url).not.toContain('/tmp/');
    });

    it('la PORTADA promociona igual, con su propio motor de bloques', async () => {
      const { url, key } = await subir(editorToken);

      const res = await request(server())
        .patch('/api/admin/homepage')
        .set('Authorization', `Bearer ${editorToken}`)
        .send({
          heroStaticTitle: 'Compra y vende',
          blocks: [bloqueVideo(url)],
        })
        .expect(200);

      expect(res.body.blocks[0].url).not.toContain('/tmp/');
      expect(await r2.head(claveDe(res.body.blocks[0].url as string))).not.toBeNull();
      expect(await r2.head(key)).toBeNull();
    });

    it('la portada también es FAIL-CLOSED', async () => {
      const inventada = r2.getPublicUrl(`${BLOCK_MEDIA_KEY_PREFIX}/tmp/${editorId}/fantasma2.mp4`);
      await request(server())
        .patch('/api/admin/homepage')
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ heroStaticTitle: 'No debería guardarse', blocks: [bloqueVideo(inventada)] })
        .expect(400);

      const config = await prisma.homepageConfig.findUnique({ where: { id: 'singleton' } });
      expect(JSON.stringify(config?.blocks ?? [])).not.toContain('fantasma2');
    });

    it('el bloque `video` de EMBED sigue funcionando, y los dos conviven en el mismo post', async () => {
      // La mutación que esta barrera mata es tocar el `name` del discriminador del embed.
      const { url } = await subir(editorToken);
      const res = await crearPost(editorToken, 'Post con los dos vídeos', [
        { id: 'e1', type: 'video', provider: 'youtube', videoId: 'dQw4w9WgXcQ' },
        bloqueVideo(url),
      ]).expect(201);

      expect(res.body.blocks[0]).toEqual({
        id: 'e1',
        type: 'video',
        provider: 'youtube',
        videoId: 'dQw4w9WgXcQ',
      });
      expect(res.body.blocks[1].type).toBe('videoUpload');
    });

    it('un `videoUpload` sin url, o con una URL ajena, se rechaza', async () => {
      await crearPost(editorToken, 'Sin url', [{ id: 'x', type: 'videoUpload' }]).expect(400);
      await crearPost(editorToken, 'Url ajena', [
        bloqueVideo('https://cdn.ajeno.com/video.mp4'),
      ]).expect(400);
    });

    it('un `type` desconocido se sigue rechazando en los dos motores', async () => {
      await crearPost(editorToken, 'Tipo raro', [{ id: 'x', type: 'videoSubido' }]).expect(400);
      await request(server())
        .patch('/api/admin/homepage')
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ heroStaticTitle: 'Hola', blocks: [{ id: 'x', type: 'videoSubido' }] })
        .expect(400);
    });
  });
});
