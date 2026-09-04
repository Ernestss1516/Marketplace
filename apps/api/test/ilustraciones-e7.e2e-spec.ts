/**
 * E7 — EL SUBSISTEMA DE ILUSTRACIONES. **Las barreras.**
 *
 * QUÉ CIERRA. Las pantallas vacías y las confirmaciones traen una imagen del modelo, y una
 * instancia puede poner la suya. El subsistema es `BrandingService` calcado (§8.3), así que
 * lo que hay que afirmar aquí es lo mismo que allí **más la propiedad que los logos no
 * tienen**: que un slot NUNCA se queda sin imagen.
 *
 * QUÉ SE AFIRMA, en orden de gravedad:
 *
 *  · **cada slot tiene SIEMPRE valor** (B1): sin ninguna fila, los diez sirven el default
 *    del modelo. Es la única propiedad cuyo incumplimiento se ve en producción como un
 *    icono roto en la pantalla más inofensiva del sitio;
 *  · **la fuga inversa**: una ilustración ACTIVA no la borra nadie;
 *  · la fuga directa: sustituir suelta la anterior, ENCOLADA y nunca en línea;
 *  · la compensación: si la fila no se escribe, el objeto subido se deshace;
 *  · que las diez claves están FUERA del whitelist de `PATCH /admin/settings/:key`;
 *  · el tamaño, la propagación por tag y quién puede tocar esto.
 *
 * SE ESPÍA LA COLA, NO EL BUCKET — molde literal de `logos-l1.e2e-spec.ts`: el contrato es
 * que la escritura **no dependa de R2**.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { Queue } from 'bullmq';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { preservarAjustes } from './helpers/settings';
import { R2Service } from 'src/infra/r2/r2.service';
import { RevalidateService } from 'src/common/revalidate/revalidate.service';
import { MediaCleanupService } from 'src/modules/media-cleanup/media-cleanup.service';
import {
  ILUSTRACIONES_CACHE_TAG,
  ILUSTRACION_IDS,
  ILUSTRACION_MAX_BYTES,
  ILUSTRACION_SETTING_KEYS,
  ILUSTRACION_SETTING_KEY_LIST,
  ILUSTRACION_SLOTS,
} from 'src/modules/ilustraciones/ilustraciones.constants';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const TINY_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>',
  'utf8',
);

describe('E7 — el subsistema de ilustraciones (e2e)', () => {
  preservarAjustes([...ILUSTRACION_SETTING_KEY_LIST]);

  let app: INestApplication;
  let prisma: PrismaClient;

  let addSpy: jest.SpyInstance;
  let deleteSpy: jest.SpyInstance;
  let revalidateSpy: jest.SpyInstance;
  let prefijo: string;

  let adminToken: string;
  let editorToken: string;
  let userToken: string;

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const propia = (key: string) => `${prefijo}${key}`;

  function ultimasClaves(): string[] {
    const purgas = addSpy.mock.calls.filter((c) => c[0] === 'purge');
    expect(purgas.length).toBeGreaterThan(0);
    return [...((purgas[purgas.length - 1][1] as { keys: string[] }).keys ?? [])].sort();
  }

  const purgasEncoladas = () => addSpy.mock.calls.filter((c) => c[0] === 'purge').length;

  function sembrar(slot: string, url: string) {
    const key = ILUSTRACION_SETTING_KEYS[slot];
    return prisma.setting.upsert({
      where: { key },
      create: { key, value: url },
      update: { value: url },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    prefijo = app.get(R2Service).getPublicUrl('');

    const cola = (app.get(MediaCleanupService) as unknown as { mediaCleanupQueue: Queue })
      .mediaCleanupQueue;
    addSpy = jest.spyOn(cola, 'add').mockResolvedValue({} as never);
    deleteSpy = jest.spyOn(app.get(R2Service), 'delete').mockResolvedValue(undefined);
    revalidateSpy = jest
      .spyOn(app.get(RevalidateService), 'revalidateTag')
      .mockImplementation(() => undefined);

    const passwordHash = await bcrypt.hash('Test1234!', 4);
    await Promise.all([
      prisma.user.create({
        data: {
          email: 'e7-admin@example.com', name: 'E7 Admin', slug: 'e7-admin',
          passwordHash, emailVerified: true, role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'e7-editor@example.com', name: 'E7 Editor', slug: 'e7-editor',
          passwordHash, emailVerified: true, role: 'EDITOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'e7-user@example.com', name: 'E7 User', slug: 'e7-user',
          passwordHash, emailVerified: true,
        },
      }),
    ]);

    const login = (email: string, endpoint = '/api/auth/login') =>
      request(server())
        .post(endpoint)
        .send({ email, password: 'Test1234!' })
        .then((r) => r.body.accessToken as string);

    adminToken = await login('e7-admin@example.com', '/api/auth/admin-login');
    editorToken = await login('e7-editor@example.com', '/api/auth/admin-login');
    userToken = await login('e7-user@example.com');
  }, 60_000);

  afterAll(async () => {
    addSpy.mockRestore();
    deleteSpy.mockRestore();
    revalidateSpy.mockRestore();
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    addSpy.mockClear();
    revalidateSpy.mockClear();
    deleteSpy.mockClear();
    await prisma.setting.deleteMany({
      where: { key: { in: [...ILUSTRACION_SETTING_KEY_LIST] } },
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 1 — cada slot tiene SIEMPRE valor. Nunca un hueco.
  // ───────────────────────────────────────────────────────────────────────────

  describe('BARRERA 1 — nunca un hueco', () => {
    it('sin ninguna fila, los DIEZ slots sirven el default del modelo', async () => {
      const { body } = await request(server()).get('/api/ilustraciones').expect(200);

      expect(Object.keys(body).sort()).toEqual([...ILUSTRACION_IDS].sort());
      for (const slot of ILUSTRACION_SLOTS) {
        expect(body[slot.id]).toEqual({
          url: slot.defecto,
          alt: slot.alt,
          ancho: slot.proporcion.ancho,
          alto: slot.proporcion.alto,
          esDefecto: true,
        });
      }
    });

    /**
     * Y con la fila BASURA también. `Setting.value` es Json: puede contener un número, un
     * objeto o `null` por una migración a medias o una edición manual. Ninguna de esas
     * cosas es una URL, y el estado correcto ante todas es el mismo — el default, no un
     * `src=""` que el navegador pinta como icono roto.
     */
    it.each([
      ['una cadena vacía', ''],
      ['un número', 42],
      ['un objeto', { url: 'x' }],
    ])('con %s en la fila, el slot cae al default', async (_nombre, valor) => {
      await prisma.setting.upsert({
        where: { key: ILUSTRACION_SETTING_KEYS['empty-search'] },
        create: { key: ILUSTRACION_SETTING_KEYS['empty-search'], value: valor as never },
        update: { value: valor as never },
      });

      const { body } = await request(server()).get('/api/ilustraciones').expect(200);
      expect(body['empty-search'].url).toBe('/ilustraciones/empty-search.svg');
      expect(body['empty-search'].esDefecto).toBe(true);
    });

    it('el endpoint es PÚBLICO: la búsqueda sin resultados se sirve sin sesión', async () => {
      await request(server()).get('/api/ilustraciones').expect(200);
    });

    it('el `alt` sale del registro y NO se puede cambiar por la API', async () => {
      // No hay ningún endpoint que acepte un `alt`: la accesibilidad no depende del admin.
      await sembrar('empty-messages', propia('ilustraciones/mia.png'));
      const { body } = await request(server()).get('/api/ilustraciones').expect(200);
      const slot = ILUSTRACION_SLOTS.find((s) => s.id === 'empty-messages')!;
      expect(body['empty-messages'].alt).toBe(slot.alt);
      expect(body['empty-messages'].esDefecto).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 2 — fuera del whitelist: el único escritor es este módulo
  // ───────────────────────────────────────────────────────────────────────────

  describe('BARRERA 2 — fuera del whitelist de ajustes', () => {
    it.each([...ILUSTRACION_SETTING_KEY_LIST])(
      'PATCH /api/admin/settings/%s → 400',
      async (key) => {
        await request(server())
          .patch(`/api/admin/settings/${encodeURIComponent(key)}`)
          .set(auth(adminToken))
          .send({ value: 'https://otro-dominio.example/x.png' })
          .expect(400);
      },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 3 — subir, servir y sustituir (el molde de branding)
  // ───────────────────────────────────────────────────────────────────────────

  describe('BARRERA 3 — el molde de branding, calcado', () => {
    it('POST deja el objeto bajo ilustraciones/, escribe el ajuste y GET lo devuelve', async () => {
      const res = await request(server())
        .post('/api/admin/ilustraciones/empty-favorites')
        .set(auth(adminToken))
        .attach('file', TINY_PNG, { filename: 'mia.png', contentType: 'image/png' })
        .expect(201);

      const url = res.body['empty-favorites'].url as string;
      expect(url.startsWith(propia('ilustraciones/'))).toBe(true);
      expect(url.endsWith('.png')).toBe(true);
      // Clave ALEATORIA, no `empty-favorites.png`: si fuera estable, el navegador serviría
      // la anterior de su caché y la limpieza no podría distinguirlas.
      expect(url).not.toContain('empty-favorites.png');
      expect(res.body['empty-favorites'].esDefecto).toBe(false);

      const { body } = await request(server()).get('/api/ilustraciones').expect(200);
      expect(body['empty-favorites'].url).toBe(url);
    });

    it('los slots son INDEPENDIENTES: sustituir uno no toca los otros nueve', async () => {
      await request(server())
        .post('/api/admin/ilustraciones/empty-tickets')
        .set(auth(adminToken))
        .attach('file', TINY_PNG, { filename: 'x.png', contentType: 'image/png' })
        .expect(201);

      const { body } = await request(server()).get('/api/ilustraciones').expect(200);
      expect(body['empty-tickets'].esDefecto).toBe(false);
      for (const id of ILUSTRACION_IDS.filter((i) => i !== 'empty-tickets')) {
        expect(body[id].esDefecto).toBe(true);
      }
    });

    it('sustituir encola la VIEJA — y sólo la vieja; la nueva vive', async () => {
      await sembrar('empty-search', propia('ilustraciones/vieja.png'));

      const res = await request(server())
        .post('/api/admin/ilustraciones/empty-search')
        .set(auth(adminToken))
        .attach('file', TINY_PNG, { filename: 'nueva.png', contentType: 'image/png' })
        .expect(201);

      expect(ultimasClaves()).toEqual(['ilustraciones/vieja.png']);
      expect(purgasEncoladas()).toBe(1);
      // ENCOLAR, NO BORRAR EN LÍNEA: R2 no entra en la transacción. Una limpieza que
      // tumbara la subida convertiría basura invisible en trabajo perdido.
      expect(deleteSpy).not.toHaveBeenCalled();

      const nueva = res.body['empty-search'].url as string;
      expect(ultimasClaves()).not.toContain(nueva.slice(prefijo.length));
    });

    it('la PRIMERA sustitución de un slot no encola nada — no había nada que soltar', async () => {
      const antes = purgasEncoladas();
      await request(server())
        .post('/api/admin/ilustraciones/success-payment')
        .set(auth(adminToken))
        .attach('file', TINY_PNG, { filename: 'p.png', contentType: 'image/png' })
        .expect(201);
      expect(purgasEncoladas()).toBe(antes);
    });

    it('DELETE devuelve el slot al default y encola su objeto', async () => {
      await sembrar('empty-notifications', propia('ilustraciones/puesta.png'));

      const res = await request(server())
        .delete('/api/admin/ilustraciones/empty-notifications')
        .set(auth(adminToken))
        .expect(200);

      expect(res.body['empty-notifications'].esDefecto).toBe(true);
      expect(res.body['empty-notifications'].url).toBe(
        '/ilustraciones/empty-notifications.svg',
      );
      expect(ultimasClaves()).toEqual(['ilustraciones/puesta.png']);
      // Se BORRA la fila, no se guarda un null: «sin fila» es el estado inicial y tener
      // dos formas de decir «sin sustituir» sería una que alguien olvidaría comprobar.
      const fila = await prisma.setting.findUnique({
        where: { key: ILUSTRACION_SETTING_KEYS['empty-notifications'] },
      });
      expect(fila).toBeNull();
    });

    it('DELETE de un slot ya sin sustituir es idempotente: 200 y nada que encolar', async () => {
      const antes = purgasEncoladas();
      const res = await request(server())
        .delete('/api/admin/ilustraciones/empty-messages')
        .set(auth(adminToken))
        .expect(200);
      expect(res.body['empty-messages'].esDefecto).toBe(true);
      expect(purgasEncoladas()).toBe(antes);
    });

    it('un slot que no existe → 400, no 404: la ruta existe, el slot no', async () => {
      await request(server())
        .post('/api/admin/ilustraciones/no-existe')
        .set(auth(adminToken))
        .attach('file', TINY_PNG, { filename: 'x.png', contentType: 'image/png' })
        .expect(400);
    });

    it('sin fichero → 400; un fichero que no es imagen → 422', async () => {
      await request(server())
        .post('/api/admin/ilustraciones/empty-favorites')
        .set(auth(adminToken))
        .expect(400);

      await request(server())
        .post('/api/admin/ilustraciones/empty-favorites')
        .set(auth(adminToken))
        .attach('file', Buffer.from('no soy una imagen'), {
          filename: 'x.txt',
          contentType: 'text/plain',
        })
        .expect(422);
    });

    it('acepta SVG, que es el formato natural de una ilustración', async () => {
      const res = await request(server())
        .post('/api/admin/ilustraciones/empty-my-listings')
        .set(auth(adminToken))
        .attach('file', TINY_SVG, { filename: 'x.svg', contentType: 'image/svg+xml' })
        .expect(201);
      expect((res.body['empty-my-listings'].url as string).endsWith('.svg')).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 4 — una ilustración ACTIVA no la borra nadie (la fuga inversa)
  // ───────────────────────────────────────────────────────────────────────────

  describe('BARRERA 4 — la fuga inversa', () => {
    /**
     * El caso: los validadores de bloque exigen «URL de nuestro almacenamiento», no un
     * prefijo concreto. Así que se puede pegar la URL de una ilustración activa en un
     * bloque de portada y luego quitar ese bloque — y sin la comprobación de
     * `laReferenciaAlguienMas`, la limpieza calcularía el diff, no encontraría dueño y
     * borraría el objeto que una pantalla está sirviendo.
     *
     * Se ejercita directamente contra `purgeReleased`, que es donde vive la regla.
     */
    it('una URL que es una ilustración ACTIVA no se encola aunque se suelte', async () => {
      const url = propia('ilustraciones/viva.png');
      await sembrar('empty-favorites', url);

      const limpieza = app.get(MediaCleanupService);
      const claves = await limpieza.purgeReleased({
        before: { blocks: [{ imageUrl: url }] },
        after: { blocks: [] },
        origen: 'test:fuga-inversa',
      });

      expect(claves).toEqual([]);
      expect(purgasEncoladas()).toBe(0);
    });

    it('una URL de ilustración que YA NO está configurada sí se limpia', async () => {
      // La red no puede tapar la fuga que sí existe: un objeto del prefijo de
      // ilustraciones que no referencia nadie es basura, y se limpia.
      const url = propia('ilustraciones/huerfana.png');

      const limpieza = app.get(MediaCleanupService);
      const claves = await limpieza.purgeReleased({
        before: { blocks: [{ imageUrl: url }] },
        after: { blocks: [] },
        origen: 'test:fuga-directa',
      });

      expect(claves).toEqual(['ilustraciones/huerfana.png']);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 5 — la compensación
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 5 — si la fila no se escribe, el objeto subido se deshace', async () => {
    // Se rompe la escritura del ajuste. El objeto ya está en el bucket cuando eso pasa, y
    // sin compensación se quedaría ahí para siempre sin que nadie lo referenciara.
    //
    // Se rompe el método del SERVICIO y no el `upsert` de Prisma: el servicio usa su
    // propio cliente inyectado, así que espiar el `PrismaClient` de este test no llegaría
    // a él — y un espía que no se dispara haría pasar la prueba sin probar nada.
    const servicio = app.get(
      (await import('src/modules/ilustraciones/ilustraciones.service')).IlustracionesService,
    );
    const escribir = jest
      .spyOn(servicio as unknown as { escribir: () => Promise<void> }, 'escribir')
      .mockRejectedValueOnce(new Error('fallo simulado'));

    await request(server())
      .post('/api/admin/ilustraciones/empty-search')
      .set(auth(adminToken))
      .attach('file', TINY_PNG, { filename: 'x.png', contentType: 'image/png' })
      .expect(500);

    // El objeto se deshace: es el ÚNICO borrado en línea del servicio.
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect((deleteSpy.mock.calls[0][0] as string).startsWith('ilustraciones/')).toBe(true);

    // Y no queda ajuste escrito.
    const fila = await prisma.setting.findUnique({
      where: { key: ILUSTRACION_SETTING_KEYS['empty-search'] },
    });
    expect(fila).toBeNull();

    escribir.mockRestore();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 6 — tamaño, propagación y quién puede
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 6 — una ilustración de más de 2 MB se rechaza y no deja ajuste', async () => {
    const grande = Buffer.alloc(ILUSTRACION_MAX_BYTES + 1024, 1);
    await request(server())
      .post('/api/admin/ilustraciones/empty-favorites')
      .set(auth(adminToken))
      .attach('file', grande, { filename: 'grande.png', contentType: 'image/png' })
      .expect(413);

    const fila = await prisma.setting.findUnique({
      where: { key: ILUSTRACION_SETTING_KEYS['empty-favorites'] },
    });
    expect(fila).toBeNull();
  });

  describe('BARRERA 7 — el cambio se propaga y sólo lo hace un ADMIN', () => {
    it('sustituir revalida el tag `ilustraciones`', async () => {
      await request(server())
        .post('/api/admin/ilustraciones/empty-favorites')
        .set(auth(adminToken))
        .attach('file', TINY_PNG, { filename: 'x.png', contentType: 'image/png' })
        .expect(201);
      expect(revalidateSpy).toHaveBeenCalledWith(ILUSTRACIONES_CACHE_TAG);
    });

    it('un DELETE que no cambia nada NO revalida — un tag tumbado de más es caché tirada', async () => {
      await request(server())
        .delete('/api/admin/ilustraciones/empty-favorites')
        .set(auth(adminToken))
        .expect(200);
      expect(revalidateSpy).not.toHaveBeenCalled();
    });

    it('EDITOR y usuario no pueden sustituir', async () => {
      for (const token of [editorToken, userToken]) {
        await request(server())
          .post('/api/admin/ilustraciones/empty-favorites')
          .set(auth(token))
          .attach('file', TINY_PNG, { filename: 'x.png', contentType: 'image/png' })
          .expect(403);
      }
    });

    it('el catálogo de admin trae descripción y proporción de los diez', async () => {
      const { body } = await request(server())
        .get('/api/admin/ilustraciones')
        .set(auth(adminToken))
        .expect(200);
      expect(body.catalogo).toHaveLength(10);
      expect(Object.keys(body.resueltas).sort()).toEqual([...ILUSTRACION_IDS].sort());
      for (const slot of body.catalogo) {
        expect(slot.descripcion.length).toBeGreaterThan(0);
        expect(slot.proporcion.ancho).toBeGreaterThan(0);
      }
    });
  });
});
