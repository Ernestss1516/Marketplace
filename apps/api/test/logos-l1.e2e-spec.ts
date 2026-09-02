/**
 * TRES LOGOS — RÁFAGA L1: EL BACKEND DE LA MARCA. **Las barreras.**
 *
 * QUÉ CIERRA. La marca de la plataforma era una constante de build y la del backoffice
 * un texto escrito a mano, así que dos instancias del mismo código eran indistinguibles
 * — y entrar en el backoffice no decía en cuál estabas. Aquí se guardan tres logos
 * independientes, uno por zona, subidos por el admin de cada instancia.
 *
 * QUÉ SE AFIRMA AQUÍ, en orden de gravedad:
 *
 *  · **la fuga INVERSA** (B5): una URL que es un logo ACTIVO no la borra nadie, venga la
 *    limpieza de donde venga. Es el caso más grave de todo L1 — no rompe una imagen de
 *    una página, rompe las tres zonas a la vez— y es el que la ráfaga hace alcanzable;
 *  · la fuga directa: cambiar o quitar un logo suelta el objeto anterior;
 *  · que las tres claves están FUERA del whitelist de `PATCH /admin/settings/:key`, o
 *    sea que el único escritor es este módulo;
 *  · que el SVG entra por el mapa MIME **propio** y el compartido sigue intacto;
 *  · el tamaño, la propagación por tag y quién puede tocar todo esto.
 *
 * SE ESPÍA LA COLA, NO EL BUCKET — molde literal de `huerfanas-h1.e2e-spec.ts` y
 * `borrado-limpieza-r2.e2e-spec.ts`: el contrato es que la escritura **no dependa de
 * R2**. La subida sí es real (hay MinIO en la corrida, igual que en
 * `h6-6-sponsored-ads`), porque lo que se afirma de ella —el prefijo y la extensión— es
 * precisamente lo que produce.
 *
 * Ver `docs/diseno-logos.md` §2, §3, §4 y §7.
 */

import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { Queue } from 'bullmq';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { preservarAjustes } from './helpers/settings';
import { R2Service } from 'src/infra/r2/r2.service';
import { RevalidateService } from 'src/common/revalidate/revalidate.service';
import { MediaCleanupService } from 'src/modules/media-cleanup/media-cleanup.service';
import { ALLOWED_MIME_TYPES } from 'src/modules/media/media.service';
import {
  LOGO_SETTING_KEYS,
  LOGO_SETTING_KEY_LIST,
} from 'src/modules/branding/branding.constants';

// 1×1 PNG en memoria, sin dependencia del sistema de ficheros (misma pieza que
// `huerfanas-h2.e2e-spec.ts`).
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Un SVG mínimo y válido. Es el formato natural de un logo, y el que L1 abre. */
const TINY_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>',
  'utf8',
);

/** La config de portada con la que se encuentra la suite y a la que la devuelve. */
const PORTADA_DEFECTO = {
  heroStaticTitle: 'Compra y vende de segunda mano',
  heroRotatingOptions: [] as string[],
  heroRotationMs: 3000,
  heroSubtitle: null as string | null,
  blocks: [
    { id: 'seed-search', type: 'search', showPopularCategories: true, popularCount: 6 },
  ] as Prisma.InputJsonValue,
};

describe('Tres logos L1 — el backend de la marca (e2e)', () => {
  // Las tres claves vuelven a su sitio pase lo que pase por medio: esta suite las
  // escribe, las cambia y las borra por la vía real, así que no hay un valor que fijar
  // de antemano — lo que hace falta es la red debajo. Molde `ajustes-interruptores`.
  preservarAjustes([...LOGO_SETTING_KEY_LIST]);

  let app: INestApplication;
  let prisma: PrismaClient;

  let addSpy: jest.SpyInstance;
  let deleteSpy: jest.SpyInstance;
  let revalidateSpy: jest.SpyInstance;
  let prefijo: string;

  let adminId: string;
  let adminToken: string;
  let editorToken: string;
  let userToken: string;

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Una URL propia bajo el prefijo que se quiera. */
  const propia = (key: string) => `${prefijo}${key}`;

  /** Las claves del último `purge` encolado. */
  function ultimasClaves(): string[] {
    const purgas = addSpy.mock.calls.filter((c) => c[0] === 'purge');
    expect(purgas.length).toBeGreaterThan(0);
    return [...((purgas[purgas.length - 1][1] as { keys: string[] }).keys ?? [])].sort();
  }

  /** Cuántos `purge` se han encolado hasta ahora (para afirmar que NO crece). */
  const purgasEncoladas = () => addSpy.mock.calls.filter((c) => c[0] === 'purge').length;

  /** Deja una zona con ese logo, sin pasar por el endpoint (fijar el terreno). */
  function sembrarLogo(zone: keyof typeof LOGO_SETTING_KEYS, url: string) {
    const key = LOGO_SETTING_KEYS[zone];
    return prisma.setting.upsert({
      where: { key },
      create: { key, value: url },
      update: { value: url },
    });
  }

  async function restaurarPortada() {
    await prisma.homepageConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...PORTADA_DEFECTO },
      update: PORTADA_DEFECTO,
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    prefijo = app.get(R2Service).getPublicUrl('');

    // UN solo espía: la cola se registra UNA vez, en `MediaCleanupModule`, así que todas
    // las superficies comparten productor.
    const cola = (app.get(MediaCleanupService) as unknown as { mediaCleanupQueue: Queue })
      .mediaCleanupQueue;
    addSpy = jest.spyOn(cola, 'add').mockResolvedValue({} as never);

    // La otra mitad del contrato: nadie borra de R2 en línea durante estas operaciones.
    deleteSpy = jest.spyOn(app.get(R2Service), 'delete').mockResolvedValue(undefined);

    // `RevalidateModule` es estático, así que hay UNA instancia compartida por todos los
    // módulos que lo importan (a diferencia de `BullModule.registerQueue`, que es
    // dinámico y produce una por registro — la trampa de `queue.constants.ts`).
    revalidateSpy = jest
      .spyOn(app.get(RevalidateService), 'revalidateTag')
      .mockImplementation(() => undefined);

    const passwordHash = await bcrypt.hash('Test1234!', 4);
    const [admin] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'l1-admin@example.com', name: 'L1 Admin', slug: 'l1-admin',
          passwordHash, emailVerified: true, role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'l1-editor@example.com', name: 'L1 Editor', slug: 'l1-editor',
          passwordHash, emailVerified: true, role: 'EDITOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'l1-user@example.com', name: 'L1 User', slug: 'l1-user',
          passwordHash, emailVerified: true,
        },
      }),
    ]);
    adminId = admin.id;

    const login = (email: string, endpoint = '/api/auth/login') =>
      request(server())
        .post(endpoint)
        .send({ email, password: 'Test1234!' })
        .then((r) => r.body.accessToken as string);

    adminToken = await login('l1-admin@example.com', '/api/auth/admin-login');
    editorToken = await login('l1-editor@example.com', '/api/auth/admin-login');
    userToken = await login('l1-user@example.com');

    await restaurarPortada();
  }, 60_000);

  afterAll(async () => {
    await restaurarPortada();
    addSpy.mockRestore();
    deleteSpy.mockRestore();
    revalidateSpy.mockRestore();
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    addSpy.mockClear();
    revalidateSpy.mockClear();
    await prisma.setting.deleteMany({ where: { key: { in: [...LOGO_SETTING_KEY_LIST] } } });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 1 — las tres claves están FUERA del whitelist de ajustes
  // ───────────────────────────────────────────────────────────────────────────

  describe('BARRERA 1 — fuera del whitelist: el único escritor es branding', () => {
    it.each([...LOGO_SETTING_KEY_LIST])(
      'PATCH /api/admin/settings/%s → 400',
      async (key) => {
        // Si esta clave entrara en el whitelist, el PATCH genérico guardaría cualquier
        // cadena —la URL de otro dominio en la cabecera de TODAS las páginas—, no
        // limpiaría el objeto anterior y no revalidaría nada. Los tres motivos de §2.2.
        await request(server())
          .patch(`/api/admin/settings/${key}`)
          .set(auth(adminToken))
          .send({ value: 'https://otro-dominio.example/logo.png' })
          .expect(400);

        expect(await prisma.setting.findUnique({ where: { key } })).toBeNull();
      },
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 2 — subir y servir
  // ───────────────────────────────────────────────────────────────────────────

  describe('BARRERA 2 — subir un logo y servirlo', () => {
    it('POST deja el objeto bajo branding/, escribe el ajuste y GET /branding lo devuelve', async () => {
      const imagenesAntes = await prisma.listingImage.count();

      const res = await request(server())
        .post('/api/admin/branding/logos/public')
        .set(auth(adminToken))
        .attach('file', TINY_PNG, { filename: 'logo.png', contentType: 'image/png' })
        .expect(201);

      // La respuesta es el objeto ENTERO, no sólo la zona tocada.
      expect(res.body.public).toMatch(/\/branding\/[0-9a-f]{32}\.png$/);
      expect(res.body.backoffice).toBeNull();
      expect(res.body.blog).toBeNull();

      // Público, sin token: el logo se le enseña a todo el mundo.
      const publico = await request(server()).get('/api/branding').expect(200);
      expect(publico.body).toEqual(res.body);

      // El ajuste, con su autor.
      const fila = await prisma.setting.findUnique({
        where: { key: LOGO_SETTING_KEYS.public },
      });
      expect(fila?.value).toBe(res.body.public);
      expect(fila?.updatedById).toBe(adminId);

      // La auditoría.
      const registro = await prisma.auditLog.findFirst({
        where: { action: 'BRANDING_LOGO_UPDATE', resourceId: LOGO_SETTING_KEYS.public },
        orderBy: { createdAt: 'desc' },
      });
      expect(registro).not.toBeNull();
      expect(registro?.resourceType).toBe('Setting');
      expect(registro?.actorId).toBe(adminId);
      expect(registro?.after).toEqual({ value: res.body.public });

      // NO crea `ListingImage`: un logo no es una imagen de anuncio (molde
      // `uploadBlockImage` / `SponsoredAdsService.uploadImage`).
      expect(await prisma.listingImage.count()).toBe(imagenesAntes);
    });

    it('las tres zonas son INDEPENDIENTES: subir una no toca las otras', async () => {
      for (const zone of ['public', 'backoffice', 'blog'] as const) {
        await request(server())
          .post(`/api/admin/branding/logos/${zone}`)
          .set(auth(adminToken))
          .attach('file', TINY_PNG, { filename: `${zone}.png`, contentType: 'image/png' })
          .expect(201);
      }

      const { body } = await request(server()).get('/api/branding').expect(200);
      const urls = [body.public, body.backoffice, body.blog];
      expect(urls.every((u: string | null) => typeof u === 'string')).toBe(true);
      expect(new Set(urls).size).toBe(3);
    });

    it('sin fila, las tres zonas son null — el estado de una instancia recién desplegada', async () => {
      const { body } = await request(server()).get('/api/branding').expect(200);
      expect(body).toEqual({ public: null, backoffice: null, blog: null });
    });

    it('una zona que no existe → 400, no 404: la ruta existe, la zona no', async () => {
      await request(server())
        .post('/api/admin/branding/logos/portada')
        .set(auth(adminToken))
        .attach('file', TINY_PNG, { filename: 'x.png', contentType: 'image/png' })
        .expect(400);
    });

    it('sin fichero → 400; un fichero que no es imagen → 422', async () => {
      await request(server())
        .post('/api/admin/branding/logos/public')
        .set(auth(adminToken))
        .expect(400);

      await request(server())
        .post('/api/admin/branding/logos/public')
        .set(auth(adminToken))
        .attach('file', Buffer.from('no soy una imagen'), {
          filename: 'x.txt',
          contentType: 'text/plain',
        })
        .expect(422);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 3 — la fuga DIRECTA: el logo viejo al cambiarlo
  // ───────────────────────────────────────────────────────────────────────────

  describe('BARRERA 3 — cambiar un logo suelta el anterior', () => {
    it('cambiar el logo encola el VIEJO — y sólo el viejo; el nuevo vive', async () => {
      await sembrarLogo('blog', propia('branding/l1-viejo.png'));

      const res = await request(server())
        .post('/api/admin/branding/logos/blog')
        .set(auth(adminToken))
        .attach('file', TINY_PNG, { filename: 'nuevo.png', contentType: 'image/png' })
        .expect(201);

      expect(ultimasClaves()).toEqual(['branding/l1-viejo.png']);
      expect(purgasEncoladas()).toBe(1);
      // Encolar, NO borrar en línea: R2 no entra en la transacción (molde B3/H1).
      expect(deleteSpy).not.toHaveBeenCalled();

      // Y lo que queda configurado es el nuevo — que no está entre lo encolado.
      const { body } = await request(server()).get('/api/branding').expect(200);
      expect(body.blog).toBe(res.body.blog);
      expect(ultimasClaves()).not.toContain(body.blog.slice(prefijo.length));
    });

    it('subir el PRIMER logo de una zona no encola nada — no había nada que soltar', async () => {
      const antes = purgasEncoladas();

      await request(server())
        .post('/api/admin/branding/logos/backoffice')
        .set(auth(adminToken))
        .attach('file', TINY_PNG, { filename: 'primero.png', contentType: 'image/png' })
        .expect(201);

      expect(purgasEncoladas()).toBe(antes);
    });

    it('DELETE devuelve la zona al fallback y encola su objeto', async () => {
      await sembrarLogo('backoffice', propia('branding/l1-quitado.svg'));

      const res = await request(server())
        .delete('/api/admin/branding/logos/backoffice')
        .set(auth(adminToken))
        .expect(200);

      expect(res.body.backoffice).toBeNull();
      expect(ultimasClaves()).toEqual(['branding/l1-quitado.svg']);
      // Sin fila, no un `null` guardado: «sin configurar» se dice de una sola manera.
      expect(
        await prisma.setting.findUnique({ where: { key: LOGO_SETTING_KEYS.backoffice } }),
      ).toBeNull();

      const registro = await prisma.auditLog.findFirst({
        where: { action: 'BRANDING_LOGO_DELETE', resourceId: LOGO_SETTING_KEYS.backoffice },
        orderBy: { createdAt: 'desc' },
      });
      expect(registro?.before).toEqual({ value: propia('branding/l1-quitado.svg') });
    });

    it('DELETE de una zona ya vacía es idempotente: 200 y nada que encolar', async () => {
      const antes = purgasEncoladas();

      await request(server())
        .delete('/api/admin/branding/logos/blog')
        .set(auth(adminToken))
        .expect(200);

      expect(purgasEncoladas()).toBe(antes);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 4 — LA FUGA INVERSA (B5). La grave.
  // ───────────────────────────────────────────────────────────────────────────

  describe('BARRERA 4 — un logo ACTIVO no lo borra nadie (la fuga inversa)', () => {
    // El vector es real y no hipotético: los validadores de bloque exigen «URL de
    // nuestro almacenamiento», NO un prefijo concreto, así que la URL del logo se puede
    // pegar en un bloque de portada o de post. Al quitar ese bloque, la limpieza de ESA
    // superficie calculaba el diff, no encontraba a nadie que la referenciara y borraba
    // el logo que las tres cabeceras estaban sirviendo.
    //
    // MUTACIÓN QUE DEBE MATAR: quitar el cruce contra `Setting` en
    // `laReferenciaAlguienMas` → estos dos casos encolan el logo.

    it('quitar de la PORTADA un bloque con la URL del logo NO borra el logo', async () => {
      const logo = propia('branding/l1-vivo-portada.svg');
      await sembrarLogo('public', logo);

      await prisma.homepageConfig.update({
        where: { id: 'singleton' },
        data: {
          blocks: [
            {
              id: 'c1',
              type: 'category-carousel',
              items: [{ categorySlug: 'x', imageUrl: logo, alt: 'a' }],
            },
          ] as Prisma.InputJsonValue,
        },
      });

      const antes = purgasEncoladas();

      await request(server())
        .patch('/api/admin/homepage')
        .set(auth(adminToken))
        .send({ heroStaticTitle: 'Compra y vende', blocks: [] })
        .expect(200);

      expect(purgasEncoladas()).toBe(antes);

      // Y sigue vivo donde importa: el ajuste y el endpoint público.
      const { body } = await request(server()).get('/api/branding').expect(200);
      expect(body.public).toBe(logo);

      await restaurarPortada();
    });

    it('quitar de un POST un bloque con la URL del logo tampoco lo borra', async () => {
      const logo = propia('branding/l1-vivo-post.png');
      await sembrarLogo('backoffice', logo);

      const post = await prisma.post.create({
        data: {
          type: 'POST',
          title: 'L1 con el logo pegado',
          slug: `l1-logo-${Date.now()}`,
          status: 'DRAFT',
          authorId: adminId,
          blocks: [{ id: 'b1', type: 'image', url: logo, alt: 'alt' }] as Prisma.InputJsonValue,
        },
      });

      const antes = purgasEncoladas();

      await request(server())
        .patch(`/api/admin/blog/${post.id}`)
        .set(auth(adminToken))
        .send({ blocks: [] })
        .expect(200);

      expect(purgasEncoladas()).toBe(antes);
      expect(
        (await prisma.setting.findUnique({ where: { key: LOGO_SETTING_KEYS.backoffice } }))
          ?.value,
      ).toBe(logo);
    });

    it('una imagen de bloque que NO es un logo se sigue limpiando — la red no tapa la fuga que sí existía', async () => {
      // El control del caso anterior: si el cruce contra `Setting` fuera demasiado ancho
      // (por ejemplo, mirando todas las claves o comparando de más), dejaría de limpiarse
      // lo que sí hay que limpiar, y H1 se habría deshecho sin que nadie lo notara.
      await sembrarLogo('public', propia('branding/l1-otro-logo.png'));

      const post = await prisma.post.create({
        data: {
          type: 'POST',
          title: 'L1 imagen normal',
          slug: `l1-normal-${Date.now()}`,
          status: 'DRAFT',
          authorId: adminId,
          blocks: [
            { id: 'b1', type: 'image', url: propia('blocks/l1-normal.jpg'), alt: 'alt' },
          ] as Prisma.InputJsonValue,
        },
      });

      await request(server())
        .patch(`/api/admin/blog/${post.id}`)
        .set(auth(adminToken))
        .send({ blocks: [] })
        .expect(200);

      expect(ultimasClaves()).toEqual(['blocks/l1-normal.jpg']);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 5 — el SVG entra por el mapa PROPIO, y el compartido sigue intacto
  // ───────────────────────────────────────────────────────────────────────────

  describe('BARRERA 5 — SVG sólo en la marca', () => {
    it('branding acepta SVG y lo guarda con su extensión', async () => {
      const res = await request(server())
        .post('/api/admin/branding/logos/public')
        .set(auth(adminToken))
        .attach('file', TINY_SVG, { filename: 'logo.svg', contentType: 'image/svg+xml' })
        .expect(201);

      expect(res.body.public).toMatch(/\/branding\/[0-9a-f]{32}\.svg$/);
    });

    it('el mapa COMPARTIDO no lo admite: avatar, portada y patrocinado siguen sin SVG', async () => {
      // La mutación que esto mata es «ampliar `MIME_TO_EXT` en vez de declarar el mapa
      // propio»: metería SVG en cinco superficies —cuatro alimentadas por usuarios o por
      // EDITOR— por el precio de la necesidad de una sola.
      expect(ALLOWED_MIME_TYPES).not.toContain('image/svg+xml');

      const svg = (url: string, token: string) =>
        request(server())
          .post(url)
          .set(auth(token))
          .attach('file', TINY_SVG, { filename: 'x.svg', contentType: 'image/svg+xml' })
          .expect(422);

      await svg('/api/media/upload-avatar', userToken);
      await svg('/api/media/upload', userToken);
      await svg('/api/admin/homepage/upload-image', adminToken);
      await svg('/api/admin/blog/upload-image', editorToken);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 6 — el tamaño
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 6 — un logo de más de 1 MB se rechaza (413) y no deja ajuste', async () => {
    // El límite propio: `MAX_FILE_SIZE` (10 MB) protege otra cosa — una foto que se ve en
    // UNA página. El logo se sirve en todas.
    const gordo = Buffer.alloc(1024 * 1024 + 1024, 1);

    await request(server())
      .post('/api/admin/branding/logos/public')
      .set(auth(adminToken))
      .attach('file', gordo, { filename: 'gordo.png', contentType: 'image/png' })
      .expect(413);

    expect(
      await prisma.setting.findUnique({ where: { key: LOGO_SETTING_KEYS.public } }),
    ).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 7 — la propagación
  // ───────────────────────────────────────────────────────────────────────────

  describe('BARRERA 7 — el cambio se propaga', () => {
    it('subir revalida el tag `branding`', async () => {
      await request(server())
        .post('/api/admin/branding/logos/blog')
        .set(auth(adminToken))
        .attach('file', TINY_PNG, { filename: 'x.png', contentType: 'image/png' })
        .expect(201);

      expect(revalidateSpy).toHaveBeenCalledWith('branding');
    });

    it('quitar también revalida — si no, la cabecera seguiría sirviendo el logo borrado', async () => {
      await sembrarLogo('blog', propia('branding/l1-para-quitar.png'));

      await request(server())
        .delete('/api/admin/branding/logos/blog')
        .set(auth(adminToken))
        .expect(200);

      expect(revalidateSpy).toHaveBeenCalledWith('branding');
    });

    it('un DELETE que no cambia nada NO revalida — un tag tumbado de más es caché tirada a la basura', async () => {
      await request(server())
        .delete('/api/admin/branding/logos/public')
        .set(auth(adminToken))
        .expect(200);

      expect(revalidateSpy).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Quién puede
  // ───────────────────────────────────────────────────────────────────────────

  describe('Sólo ADMIN toca la marca', () => {
    /** Ni subir ni quitar: las dos puertas, o la mitad del gate no existe. */
    async function niSubirNiQuitar(token: string) {
      await request(server())
        .post('/api/admin/branding/logos/public')
        .set(auth(token))
        .attach('file', TINY_PNG, { filename: 'x.png', contentType: 'image/png' })
        .expect(403);

      await request(server())
        .delete('/api/admin/branding/logos/public')
        .set(auth(token))
        .expect(403);
    }

    it('un usuario normal no puede → 403', () => niSubirNiQuitar(userToken));

    // EDITOR sí sube imágenes de blog y de bloque; la marca no. Es el argumento de
    // `HomepageService.uploadImage`: que el rol de subir coincida con el de poder usar
    // lo subido — y un logo lo usa la plataforma entera, no un artículo.
    it('un EDITOR tampoco → 403', () => niSubirNiQuitar(editorToken));

    it('sin sesión tampoco → 401, pero el GET público sigue abierto', async () => {
      await request(server()).post('/api/admin/branding/logos/public').expect(401);
      await request(server()).get('/api/branding').expect(200);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // El contrato, de una pieza
  // ───────────────────────────────────────────────────────────────────────────

  it('en TODA la suite no se ha borrado nada de R2 en línea: sólo se ha encolado', () => {
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
