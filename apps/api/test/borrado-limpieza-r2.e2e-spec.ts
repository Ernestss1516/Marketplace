/**
 * BORRADO — RÁFAGA B3: LA LIMPIEZA DEL BUCKET.
 *
 * QUÉ CIERRA. Hasta B3, borrar un anuncio dejaba sus ficheros en R2 **para
 * siempre**: la fila de `ListingImage` desaparecía por cascada y el objeto se
 * quedaba. Y no era un objeto por imagen sino DOS — el original y una miniatura
 * cuya clave `ImageProcessor` deriva y **no guarda en ninguna columna**—, así que
 * quien limpiara mirando sólo la base de datos habría borrado la mitad.
 *
 * QUÉ SE AFIRMA AQUÍ, y qué no. Que los dos caminos que destruyen un anuncio
 * —descartar un borrador y eliminar como staff— **encolan la limpieza con las
 * claves correctas**. Que esas claves sean las que son lo fija
 * `src/infra/r2/media-keys.spec.ts`; que el procesador las borre y aguante fallos,
 * su propio caso al final.
 *
 * SE ESPÍA LA COLA Y NO EL BUCKET, y es deliberado: R2 es I/O externa y el
 * contrato de B3 es precisamente que el borrado **no dependa de ella** — la fila
 * se va, la limpieza se encola, y si el bucket falla se reintenta. Comprobar aquí
 * el objeto real ataría este test a que haya un MinIO despierto, que es justo el
 * acoplamiento que el diseño evitó (§3.1: basura, no corrupción).
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { Queue } from 'bullmq';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { R2Service } from 'src/infra/r2/r2.service';
import { MediaCleanupProcessor } from 'src/infra/queue/processors/media-cleanup.processor';
import { AdminService } from 'src/modules/admin/admin.service';
import { ListingsService } from 'src/modules/listings/listings.service';

describe('Borrado B3 — la limpieza de R2 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  /**
   * UN ESPÍA POR SERVICIO, y no uno solo sobre el token de la cola.
   *
   * `@nestjs/bullmq` crea una instancia de `Queue` **por cada
   * `registerQueue()` del mismo nombre** — está documentado en
   * `queue.constants.ts`, que existe justamente por esa trampa. `AdminModule` y
   * `ListingsModule` registran los dos `media-cleanup`, así que hay DOS objetos
   * `Queue` distintos y `app.get(getQueueToken(...))` devuelve sólo uno.
   *
   * Espiar ese único token dejaba el camino del borrador sin vigilar: el test
   * pasaba en el caso del staff y fallaba en el del borrador **sin que la
   * implementación tuviera nada malo**. Se espía el que cada servicio inyecta.
   */
  let addSpies: jest.SpyInstance[];
  let prefijo: string;

  let sellerToken: string;
  let adminToken: string;
  let sellerId: string;
  let categoryId: string;

  const server = () => app.getHttpServer();

  /** Un anuncio del vendedor con dos fotos, vídeo y póster. */
  async function crearConFicheros(status: string, sufijo: string) {
    const listing = await prisma.listing.create({
      data: {
        title: `BR2 ${sufijo}`,
        slug: `br2-${sufijo}-${Date.now()}`,
        description: 'x',
        price: 10,
        type: 'PRODUCT',
        status: status as never,
        sellerId,
        categoryId,
        videoUrl: `${prefijo}video/${sufijo}.mp4`,
        videoPosterUrl: `${prefijo}video/${sufijo}.jpg`,
      },
    });
    await prisma.listingImage.createMany({
      data: [
        { listingId: listing.id, url: `${prefijo}media/${sufijo}-1.jpg` },
        { listingId: listing.id, url: `${prefijo}media/${sufijo}-2.png` },
      ],
    });
    return listing;
  }

  /** Todos los `purge` encolados, vengan del servicio que vengan. */
  function purgas(): { keys: string[] }[] {
    return addSpies
      .flatMap((s) => s.mock.calls)
      .filter((c) => c[0] === 'purge')
      .map((c) => c[1] as { keys: string[] });
  }

  /** Las claves del último job de limpieza encolado. */
  function ultimasClaves(): string[] {
    const jobs = purgas();
    expect(jobs.length).toBeGreaterThan(0);
    return [...(jobs[jobs.length - 1].keys ?? [])].sort();
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    prefijo = app.get(R2Service).getPublicUrl('');

    // Se espía `add` en vez de dejar que el job corra: lo que este fichero fija es
    // QUÉ se encola. Que el worker lo procese bien es el último bloque.
    const colas = [
      (app.get(AdminService) as unknown as { mediaCleanupQueue: Queue }).mediaCleanupQueue,
      (app.get(ListingsService) as unknown as { mediaCleanupQueue: Queue }).mediaCleanupQueue,
    ];
    addSpies = colas.map((c) => jest.spyOn(c, 'add').mockResolvedValue({} as never));

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [seller] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'br2-seller@example.com', name: 'BR2 Seller', slug: 'br2-seller',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'br2-admin@example.com', name: 'BR2 Admin', slug: 'br2-admin',
          passwordHash, emailVerified: true, role: 'ADMIN',
        },
      }),
    ]);
    sellerId = seller.id;

    const category = await prisma.category.create({
      data: { name: 'BR2 Cat', slug: 'br2-cat', attributeSchema: [] },
    });
    categoryId = category.id;

    sellerToken = (
      await request(server()).post('/api/auth/login').send({
        email: 'br2-seller@example.com', password: 'Test1234!',
      })
    ).body.accessToken as string;
    adminToken = (
      await request(server()).post('/api/auth/admin-login').send({
        email: 'br2-admin@example.com', password: 'Test1234!',
      })
    ).body.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    addSpies.forEach((s) => s.mockRestore());
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => addSpies.forEach((s) => s.mockClear()));

  it('eliminar como staff encola la limpieza con SEIS claves: dos por foto, más vídeo y póster', async () => {
    const anuncio = await crearConFicheros('ARCHIVED', 'staff');

    await request(server())
      .delete(`/api/admin/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    expect(ultimasClaves()).toEqual([
      'media/staff-1-thumb.webp',
      'media/staff-1.jpg',
      'media/staff-2-thumb.webp',
      'media/staff-2.png',
      'video/staff.jpg',
      'video/staff.mp4',
    ]);
  });

  it('descartar un borrador también limpia — era la fuente de huérfanas más vieja', async () => {
    // `docs/pendientes.md` lo describía así: «las imágenes de wizards abandonados
    // quedan huérfanas para siempre». El wizard sube las fotos ANTES de publicar,
    // así que un borrador descartado dejaba ficheros sin dueño.
    const anuncio = await crearConFicheros('DRAFT', 'borrador');

    await request(server())
      .delete(`/api/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(204);

    expect(ultimasClaves()).toEqual([
      'media/borrador-1-thumb.webp',
      'media/borrador-1.jpg',
      'media/borrador-2-thumb.webp',
      'media/borrador-2.png',
      'video/borrador.jpg',
      'video/borrador.mp4',
    ]);
  });

  it('un anuncio SIN ficheros no encola nada — un job vacío es ruido en la cola', async () => {
    const anuncio = await prisma.listing.create({
      data: {
        title: 'BR2 sin ficheros', slug: `br2-vacio-${Date.now()}`, description: 'x',
        price: 10, type: 'PRODUCT', status: 'ARCHIVED', sellerId, categoryId,
      },
    });

    await request(server())
      .delete(`/api/admin/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    expect(purgas()).toHaveLength(0);
  });

  it('un borrado que NO procede tampoco encola limpieza', async () => {
    // La guarda de estado corta antes: si encolara igual, borraría los ficheros
    // de un anuncio que sigue vivo. Es el peor fallo posible de esta ráfaga.
    const anuncio = await crearConFicheros('ACTIVE', 'vivo');

    await request(server())
      .delete(`/api/admin/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(purgas()).toHaveLength(0);
    expect(await prisma.listing.findUnique({ where: { id: anuncio.id } })).not.toBeNull();
  });

  describe('el procesador aguanta lo que R2 le haga', () => {
    function procesadorCon(deleteImpl: jest.Mock) {
      return new MediaCleanupProcessor({ delete: deleteImpl } as never);
    }

    it('borra todas las claves del trabajo', async () => {
      const del = jest.fn().mockResolvedValue(undefined);
      await procesadorCon(del).process({ data: { keys: ['a', 'b', 'c'] } } as never);

      expect(del).toHaveBeenCalledTimes(3);
      expect(del.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c']);
    });

    it('un fallo SUELTO no impide borrar el resto', async () => {
      // «No dejar limpiar no debe romper nada» — el criterio que ya usaba
      // `VideoService.deleteObjectByUrl`. Si una imagen se resiste, las otras
      // nueve se van igual.
      const del = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('403'))
        .mockResolvedValueOnce(undefined);

      await expect(
        procesadorCon(del).process({ data: { keys: ['a', 'b', 'c'] } } as never),
      ).resolves.toBeUndefined();
      expect(del).toHaveBeenCalledTimes(3);
    });

    it('pero si NO se puede borrar NINGUNA, se propaga para que se reintente', async () => {
      // Un bucket que rechaza todo no es un fichero rebelde: es una credencial
      // caducada o un permiso mal puesto, y eso se arregla, no se tolera.
      const del = jest.fn().mockRejectedValue(new Error('403'));

      await expect(
        procesadorCon(del).process({ data: { keys: ['a', 'b'] } } as never),
      ).rejects.toThrow(/No se pudo borrar NINGUNO/);
    });

    it('un trabajo sin claves no llama a R2', async () => {
      const del = jest.fn();
      await procesadorCon(del).process({ data: { keys: [] } } as never);
      expect(del).not.toHaveBeenCalled();
    });
  });
});
