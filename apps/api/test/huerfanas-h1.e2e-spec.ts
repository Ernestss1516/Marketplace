/**
 * HUÉRFANAS SIN FILA — RÁFAGA H1: «LO QUE SE SUELTA». **Las barreras.**
 *
 * QUÉ CIERRA. Cuatro operaciones soltaban ficheros de R2 que **no tienen fila propia**:
 * sustituir el avatar, editar o borrar un post (imágenes de bloque), guardar la portada y
 * cambiar la imagen de un patrocinado. El objeto se quedaba en el bucket para siempre — no
 * porque nadie lo hubiera decidido, sino porque la referencia vivía dentro de una columna o
 * de un `Json` y al pisarla no quedaba rastro de lo que había.
 *
 * QUÉ SE AFIRMA AQUÍ. Que cada una de esas operaciones **encola** la limpieza de lo que
 * soltó, y —igual de importante— que **no encola lo que no debe**: la URL ajena (el avatar
 * de Google), la compartida por otro dueño, la que tiene fila (`ListingImage`, toda la
 * imaginería del blog), y la que sigue estando después de editar.
 *
 * SE ESPÍA LA COLA, NO EL BUCKET — molde literal de `borrado-limpieza-r2.e2e-spec.ts`. El
 * contrato de H1 es precisamente que la escritura **no dependa de R2**: la fila se guarda,
 * la limpieza se encola, y si el bucket falla la cola reintenta. Comprobar el objeto real
 * ataría este fichero a que haya un MinIO despierto, que es el acoplamiento que el diseño
 * evitó. Que el procesador borre de verdad ya tiene su caso en B3.
 *
 * NO ES H2. El avatar subido y nunca guardado y el vídeo sin confirmar necesitan prefijo
 * efímero y caducidad — otra ráfaga. Ver `docs/diseno-huerfanas-sin-fila.md`.
 */

import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { Queue } from 'bullmq';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { R2Service } from 'src/infra/r2/r2.service';
import { MediaCleanupService } from 'src/modules/media-cleanup/media-cleanup.service';

/** La config de portada con la que se encuentra la suite y a la que la devuelve (molde
 *  `homepage.e2e-spec.ts`: la fila es única, estática y compartida entre suites). */
const PORTADA_DEFECTO = {
  heroStaticTitle: 'Compra y vende de segunda mano',
  heroRotatingOptions: [] as string[],
  heroRotationMs: 3000,
  heroSubtitle: null as string | null,
  blocks: [
    { id: 'seed-search', type: 'search', showPopularCategories: true, popularCount: 6 },
  ] as Prisma.InputJsonValue,
};

describe('Huérfanas H1 — lo que se suelta se encola (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let addSpy: jest.SpyInstance;
  let deleteSpy: jest.SpyInstance;
  let prefijo: string;

  let adminId: string;
  let adminToken: string;
  let categoryId: string;

  const server = () => app.getHttpServer();

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

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    prefijo = app.get(R2Service).getPublicUrl('');

    // UN solo espía: la cola se registra UNA vez, en `MediaCleanupModule`, así que las
    // cuatro superficies comparten productor. (En B3 hubo que espiar uno por servicio
    // justo porque cada módulo registraba el suyo — ver `queue.constants.ts`.)
    const cola = (app.get(MediaCleanupService) as unknown as { mediaCleanupQueue: Queue })
      .mediaCleanupQueue;
    addSpy = jest.spyOn(cola, 'add').mockResolvedValue({} as never);

    // La otra mitad del contrato: NADIE borra de R2 en línea durante estas operaciones.
    deleteSpy = jest.spyOn(app.get(R2Service), 'delete').mockResolvedValue(undefined);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const admin = await prisma.user.create({
      data: {
        email: 'h1-admin@example.com', name: 'H1 Admin', slug: 'h1-admin',
        passwordHash, emailVerified: true, role: 'ADMIN',
      },
    });
    adminId = admin.id;

    adminToken = await request(server())
      .post('/api/auth/admin-login')
      .send({ email: 'h1-admin@example.com', password: 'Test1234!' })
      .then((r) => r.body.accessToken as string);

    categoryId = (
      await prisma.category.create({
        data: { name: 'H1 Cat', slug: `h1-cat-${Date.now()}`, attributeSchema: [] },
      })
    ).id;

    await prisma.homepageConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...PORTADA_DEFECTO },
      update: PORTADA_DEFECTO,
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.homepageConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...PORTADA_DEFECTO },
      update: PORTADA_DEFECTO,
    });
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 1 — el avatar sustituido (fuga 1a)
  // ───────────────────────────────────────────────────────────────────────────

  describe('BARRERA 1 — el avatar sustituido', () => {
    async function crearUsuario(sufijo: string, avatarUrl: string | null) {
      const passwordHash = await bcrypt.hash('Test1234!', 10);
      const user = await prisma.user.create({
        data: {
          email: `h1-${sufijo}@example.com`, name: `H1 ${sufijo}`, slug: `h1-${sufijo}`,
          passwordHash, emailVerified: true, avatarUrl,
        },
      });
      const token = await request(server())
        .post('/api/auth/login')
        .send({ email: user.email, password: 'Test1234!' })
        .then((r) => r.body.accessToken as string);
      return { user, token };
    }

    it('cambiar el avatar encola el VIEJO — y sólo el viejo', async () => {
      const viejo = propia('avatars/h1-viejo.jpg');
      const { token } = await crearUsuario('av1', viejo);

      await request(server())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ avatarUrl: propia('avatars/h1-nuevo.jpg') })
        .expect(200);

      expect(ultimasClaves()).toEqual(['avatars/h1-viejo.jpg']);
      // Encolar, NO borrar en línea: R2 no entra en la transacción (molde B3).
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('si el viejo es de GOOGLE (URL ajena) no se encola nada', async () => {
      // `keyFromPublicUrl` devuelve null para una URL que no es nuestra, y sin clave no
      // hay borrado posible: se dejaría de tocar aunque alguien lo intentara. Ésta es la
      // razón por la que el guardarraíl NO es `@IsOwnStorageUrl` en el DTO — rompería
      // los avatares de Google, que son legítimos.
      const { token } = await crearUsuario('av2', 'https://lh3.googleusercontent.com/a/foto');
      const antes = purgasEncoladas();

      await request(server())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ avatarUrl: propia('avatars/h1-propio.jpg') })
        .expect(200);

      expect(purgasEncoladas()).toBe(antes);
    });

    it('si OTRO usuario comparte ese avatar, NO se borra', async () => {
      // Hoy es posible de verdad: `UpdateMeDto.avatarUrl` es un `@IsString()` pelado, así
      // que cualquiera puede guardar como suyo el avatar de otro. Sin este `count`, el
      // primero que cambiara de foto dejaría al otro sin la suya.
      const compartido = propia('avatars/h1-compartido.jpg');
      const { token } = await crearUsuario('av3', compartido);
      await crearUsuario('av4', compartido);
      const antes = purgasEncoladas();

      await request(server())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ avatarUrl: propia('avatars/h1-otro.jpg') })
        .expect(200);

      expect(purgasEncoladas()).toBe(antes);
    });

    it('guardar el perfil sin tocar el avatar no encola nada', async () => {
      const { token } = await crearUsuario('av5', propia('avatars/h1-quieto.jpg'));
      const antes = purgasEncoladas();

      await request(server())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ bio: 'Cambio que no toca la foto' })
        .expect(200);

      expect(purgasEncoladas()).toBe(antes);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 2 — las imágenes que salen de un bloque
  // ───────────────────────────────────────────────────────────────────────────

  describe('BARRERA 2 — el blog', () => {
    async function crearPost(sufijo: string, blocks: unknown, coverUrl?: string) {
      return prisma.post.create({
        data: {
          type: 'POST',
          title: `H1 ${sufijo}`,
          slug: `h1-${sufijo}-${Date.now()}`,
          status: 'DRAFT',
          authorId: adminId,
          blocks: blocks as Prisma.InputJsonValue,
          coverUrl: coverUrl ?? null,
        },
      });
    }

    const bloqueImagen = (id: string, url: string) => ({ id, type: 'image', url, alt: 'alt' });

    it('quitar una imagen de un bloque encola SU clave', async () => {
      const fuera = propia('blocks/h1-sale.jpg');
      const queda = propia('blocks/h1-queda.jpg');
      const post = await crearPost('edit', [bloqueImagen('b1', fuera), bloqueImagen('b2', queda)]);

      await request(server())
        .patch(`/api/admin/blog/${post.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ blocks: [bloqueImagen('b2', queda)] })
        .expect(200);

      expect(ultimasClaves()).toEqual(['blocks/h1-sale.jpg']);
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('AÑADIR una imagen no encola nada, y editar sin tocarlas tampoco', async () => {
      const una = propia('blocks/h1-una.jpg');
      const post = await crearPost('add', [bloqueImagen('b1', una)]);
      const antes = purgasEncoladas();

      await request(server())
        .patch(`/api/admin/blog/${post.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ blocks: [bloqueImagen('b1', una), bloqueImagen('b2', propia('blocks/h1-dos.jpg'))] })
        .expect(200);
      expect(purgasEncoladas()).toBe(antes);

      await request(server())
        .patch(`/api/admin/blog/${post.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Otro título, mismas imágenes' })
        .expect(200);
      expect(purgasEncoladas()).toBe(antes);
    });

    it('BARRERA 3 — la encuentra aunque el campo se llame de otra forma y esté anidado', async () => {
      // Éste es el caso que mata la mutación «enumerar campos»: la URL no está en `url`
      // ni en `imageUrl`, sino dentro de un objeto anidado. `ownUrlsDeep` mira el valor
      // ENTERO, así que da igual cómo se llame el campo o qué profundidad tenga — que es
      // lo que hace que un tipo de bloque nuevo no abra una fuga en silencio.
      const escondida = propia('blocks/h1-escondida.jpg');
      const post = await crearPost('raro', [
        { id: 'b1', type: 'grid', items: [{ media: { kind: 'image', fuente: escondida } }] },
      ]);

      await request(server())
        .patch(`/api/admin/blog/${post.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ blocks: [] })
        .expect(200);

      expect(ultimasClaves()).toEqual(['blocks/h1-escondida.jpg']);
    });

    it('borrar el post encola sus imágenes de bloque, pero NO la portada, que tiene fila', async () => {
      // La frontera con la basura CON FILA, medida: la portada del blog sube por
      // `POST /media/upload` y **tiene** `ListingImage`. Borrar su objeto dejaría la fila
      // apuntando a un fichero inexistente — peor que la huérfana. Esa clase es otra
      // deuda y aquí no se toca.
      const deBloque = propia('blocks/h1-del-post.jpg');
      const portada = propia('media/h1-portada.jpg');
      await prisma.listingImage.create({ data: { url: portada, uploadedById: adminId } });
      const post = await crearPost('borrar', [bloqueImagen('b1', deBloque)], portada);

      await request(server())
        .delete(`/api/admin/blog/${post.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      expect(ultimasClaves()).toEqual(['blocks/h1-del-post.jpg']);
    });

    it('una imagen que TAMBIÉN usa otro post no se borra', async () => {
      const compartida = propia('blocks/h1-dos-posts.jpg');
      const post = await crearPost('comp-a', [bloqueImagen('b1', compartida)]);
      await crearPost('comp-b', [bloqueImagen('b1', compartida)]);
      const antes = purgasEncoladas();

      await request(server())
        .patch(`/api/admin/blog/${post.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ blocks: [] })
        .expect(200);

      expect(purgasEncoladas()).toBe(antes);
    });
  });

  describe('BARRERA 2 — la portada', () => {
    it('guardar la portada sin un bloque encola la imagen que salió', async () => {
      const salida = propia('homepage/h1-carrusel.png');
      await prisma.homepageConfig.update({
        where: { id: 'singleton' },
        data: {
          blocks: [
            {
              id: 'c1',
              type: 'category-carousel',
              items: [{ categorySlug: 'x', imageUrl: salida, alt: 'a' }],
            },
          ] as Prisma.InputJsonValue,
        },
      });

      await request(server())
        .patch('/api/admin/homepage')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ heroStaticTitle: 'Compra y vende', blocks: [] })
        .expect(200);

      expect(ultimasClaves()).toEqual(['homepage/h1-carrusel.png']);
      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  describe('BARRERA 2 — el patrocinado', () => {
    async function crearPatrocinado(imageUrl: string) {
      return prisma.sponsoredAd.create({
        data: {
          imageUrl,
          title: 'H1 patrocinado',
          description: 'x',
          targetUrl: 'https://ejemplo.com',
          categoryId,
        },
      });
    }

    it('cambiar la imagen encola la anterior', async () => {
      const anterior = propia('sponsored/h1-anterior.png');
      const ad = await crearPatrocinado(anterior);

      await request(server())
        .patch(`/api/admin/sponsored-ads/${ad.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ imageUrl: propia('sponsored/h1-nueva.png') })
        .expect(200);

      expect(ultimasClaves()).toEqual(['sponsored/h1-anterior.png']);
    });

    it('DESACTIVAR no suelta ningún fichero — no hay borrado en esta superficie', async () => {
      const ad = await crearPatrocinado(propia('sponsored/h1-viva.png'));
      const antes = purgasEncoladas();

      await request(server())
        .patch(`/api/admin/sponsored-ads/${ad.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(200);

      // La fila sigue ahí con su `imageUrl`: el diff sale vacío por construcción.
      expect(purgasEncoladas()).toBe(antes);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EL CONTRATO, de una pieza
  // ───────────────────────────────────────────────────────────────────────────

  it('en TODA la suite no se ha borrado nada de R2 en línea: sólo se ha encolado', () => {
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(purgasEncoladas()).toBeGreaterThan(0);
  });
});
