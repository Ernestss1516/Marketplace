/**
 * 2b — LAS FOTOS DE UN ANUNCIO, POR UN SOLO CAMINO.
 *
 * Hasta esta ráfaga había DOS implementaciones de «pon estas fotos en este anuncio» y no
 * hacían lo mismo. Lo que se fija aquí son las cuatro diferencias, y **cada barrera
 * afirma contra el EFECTO, no contra el síntoma**:
 *
 *   · el `order` se escribe → se lee el orden GUARDADO, no el 200;
 *   · el staff valida como el dueño → tope, existencia y propiedad;
 *   · **aislamiento entre anuncios** → se afirma que la VÍCTIMA conserva su foto, no que
 *     el atacante recibió un 422. Un arreglo que devolviera el error correcto y aun así
 *     moviera la fila pasaría el segundo test y fallaría el primero;
 *   · **el desvinculador es COMPARTIDO** → la misma barrera ejercida por los DOS caminos.
 *     Con una sola de las dos mitades, «limpiar sólo en staff» pasaría — y eso es
 *     exactamente lo que la decisión (§5.3) descartó.
 *
 * SE ESPÍA LA COLA Y NO EL BUCKET, molde literal de `borrado-limpieza-r2.e2e-spec.ts`:
 * el contrato de B3 es que la escritura NO dependa de R2. Y aquí basta UN espía, no uno
 * por servicio: los dos caminos comparten el `ListingImagesService`, que es justamente
 * lo que esta ráfaga vino a conseguir.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { Queue } from 'bullmq';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { R2Service } from 'src/infra/r2/r2.service';
import { ListingImagesService } from 'src/modules/listings/listing-images.service';

describe('2b — las imágenes de un anuncio (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let addSpy: jest.SpyInstance;
  let prefijo: string;

  let sellerToken: string;
  let adminToken: string;
  let sellerId: string;
  let otroId: string;
  let categoryId: string;

  const server = () => app.getHttpServer();

  let n = 0;
  /** Un anuncio del vendedor con `fotos` imágenes suyas, en orden. */
  async function crearConFotos(fotos: number, sufijo: string) {
    const listing = await prisma.listing.create({
      data: {
        title: `IMG ${sufijo}`,
        slug: `img-${sufijo}-${++n}-${Date.now()}`,
        description: 'x',
        price: 10,
        type: 'PRODUCT',
        status: 'ACTIVE',
        sellerId,
        categoryId,
      },
    });
    const imagenes = [];
    for (let i = 0; i < fotos; i += 1) {
      imagenes.push(
        await prisma.listingImage.create({
          data: {
            listingId: listing.id,
            url: `${prefijo}media/${sufijo}-${i}.jpg`,
            order: i,
            uploadedById: sellerId,
          },
        }),
      );
    }
    return { listing, imagenes };
  }

  /** Una imagen SUELTA (subida y aún sin anuncio), de quien se diga. */
  function crearSuelta(dueño: string, sufijo: string) {
    return prisma.listingImage.create({
      data: { url: `${prefijo}media/suelta-${sufijo}.jpg`, uploadedById: dueño },
    });
  }

  /** El orden guardado, tal cual está en la base. */
  async function ordenGuardado(listingId: string): Promise<string[]> {
    const filas = await prisma.listingImage.findMany({
      where: { listingId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });
    return filas.map((f) => f.id);
  }

  /** Las claves de todos los `purge` encolados desde el último `clear`. */
  function clavesEncoladas(): string[] {
    return addSpy.mock.calls
      .filter((c) => c[0] === 'purge')
      .flatMap((c) => (c[1] as { keys: string[] }).keys ?? [])
      .sort();
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    prefijo = app.get(R2Service).getPublicUrl('');

    // UN SOLO ESPÍA, y eso ES el resultado de la ráfaga. `borrado-limpieza-r2` necesita
    // uno por servicio porque `AdminModule` y `ListingsModule` registran cada uno su
    // `media-cleanup` y hay dos objetos `Queue`. Aquí los dos caminos pasan por el mismo
    // proveedor, así que hay una sola cola que vigilar.
    const cola = (app.get(ListingImagesService) as unknown as { mediaCleanupQueue: Queue })
      .mediaCleanupQueue;
    addSpy = jest.spyOn(cola, 'add').mockResolvedValue({} as never);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [seller, otro] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'img-seller@example.com', name: 'IMG Seller', slug: 'img-seller',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'img-otro@example.com', name: 'IMG Otro', slug: 'img-otro',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'img-admin@example.com', name: 'IMG Admin', slug: 'img-admin',
          passwordHash, emailVerified: true, role: 'ADMIN',
        },
      }),
    ]);
    sellerId = seller.id;
    otroId = otro.id;

    categoryId = (
      await prisma.category.create({
        data: { name: 'IMG Cat', slug: 'img-cat', attributeSchema: [] },
      })
    ).id;

    sellerToken = (
      await request(server()).post('/api/auth/login').send({
        email: 'img-seller@example.com', password: 'Test1234!',
      })
    ).body.accessToken as string;
    adminToken = (
      await request(server()).post('/api/auth/admin-login').send({
        email: 'img-admin@example.com', password: 'Test1234!',
      })
    ).body.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    addSpy.mockRestore();
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => addSpy.mockClear());

  // ───────────────────────────────────────────────────────────────────────────
  // (1) EL ORDER
  // ───────────────────────────────────────────────────────────────────────────

  it('LA BARRERA (order): el staff reordena y las fotos QUEDAN en ese orden', async () => {
    // Antes de 2b esto respondía 200 y no movía nada: el camino de staff enlazaba con un
    // `updateMany` que no escribía `order`. Se lee la BASE, no el código de respuesta.
    const { listing, imagenes } = await crearConFotos(3, 'orden-staff');
    const [a, b, c] = imagenes.map((i) => i.id);

    await request(server())
      .patch(`/api/admin/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ imageIds: [c, a, b], reason: 'Reordenar la galería' })
      .expect(200);

    expect(await ordenGuardado(listing.id)).toEqual([c, a, b]);
  });

  it('y el dueño reordena igual (el camino que ya lo hacía, sin regresión)', async () => {
    const { listing, imagenes } = await crearConFotos(3, 'orden-dueno');
    const [a, b, c] = imagenes.map((i) => i.id);

    await request(server())
      .patch(`/api/listings/${listing.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ imageIds: [b, c, a] })
      .expect(200);

    expect(await ordenGuardado(listing.id)).toEqual([b, c, a]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // (3) EL AISLAMIENTO ENTRE ANUNCIOS — el fallo de seguridad
  // ───────────────────────────────────────────────────────────────────────────

  it('LA BARRERA (seguridad): un imageId AJENO no se lleva la foto de su anuncio', async () => {
    const victima = await crearConFotos(2, 'victima');
    const atacante = await crearConFotos(1, 'atacante');
    const robada = victima.imagenes[0].id;

    // El `where: { id: { in: imageIds } }` que había NO acotaba a este anuncio: esta
    // petición le habría arrancado la foto a la víctima.
    //
    // EL CÓDIGO DE RESPUESTA SE COMPRUEBA AL FINAL, Y NO ES UN DETALLE DE ESTILO. Con el
    // `.expect(422)` encadenado aquí, la aserción sobre la víctima no llegaba a
    // ejecutarse cuando el guard fallaba — o sea, el test no podía distinguir «rechazó»
    // de «rechazó Y además no movió nada», que es lo que de verdad importa. En este
    // orden hay DOS capas medidas por separado: primero el dato, después el aviso.
    const res = await request(server())
      .patch(`/api/admin/listings/${atacante.listing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        imageIds: [atacante.imagenes[0].id, robada],
        reason: 'Intento de llevarse una foto ajena',
      });

    // ── CAPA 1, LA QUE IMPORTA: LA VÍCTIMA CONSERVA SU FOTO ──────────────────
    expect(await ordenGuardado(victima.listing.id)).toEqual(victima.imagenes.map((i) => i.id));
    const sigue = await prisma.listingImage.findUnique({ where: { id: robada } });
    expect(sigue?.listingId).toBe(victima.listing.id);

    // Y el anuncio del atacante se queda como estaba: la operación no se aplica a medias.
    expect(await ordenGuardado(atacante.listing.id)).toEqual([atacante.imagenes[0].id]);

    // ── CAPA 2: y además se rechaza en vez de fingir que se hizo ─────────────
    expect(res.status).toBe(422);
  });

  it('y tampoco por el camino del dueño', async () => {
    const victima = await crearConFotos(1, 'victima-dueno');
    const atacante = await crearConFotos(1, 'atacante-dueno');
    const robada = victima.imagenes[0].id;

    const res = await request(server())
      .patch(`/api/listings/${atacante.listing.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ imageIds: [atacante.imagenes[0].id, robada] });

    const sigue = await prisma.listingImage.findUnique({ where: { id: robada } });
    expect(sigue?.listingId).toBe(victima.listing.id);
    expect(res.status).toBe(422);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // (2) LAS TRES VALIDACIONES — el staff valida igual que el dueño
  // ───────────────────────────────────────────────────────────────────────────

  it('el staff valida IGUAL: existencia', async () => {
    const { listing, imagenes } = await crearConFotos(1, 'existe');

    await request(server())
      .patch(`/api/admin/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ imageIds: [imagenes[0].id, 'no-existe-este-id'], reason: 'Foto inventada' })
      .expect(422);

    expect(await ordenGuardado(listing.id)).toEqual([imagenes[0].id]);
  });

  it('el staff valida IGUAL: propiedad — una suelta de un TERCERO no se puede enganchar', async () => {
    const { listing, imagenes } = await crearConFotos(1, 'propiedad');
    const ajena = await crearSuelta(otroId, 'de-un-tercero');

    // La propiedad se mide contra el VENDEDOR del anuncio, no contra el moderador que
    // ejecuta: un moderador edita el anuncio de otra persona.
    await request(server())
      .patch(`/api/admin/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ imageIds: [imagenes[0].id, ajena.id], reason: 'Foto de un tercero' })
      .expect(422);

    const sigue = await prisma.listingImage.findUnique({ where: { id: ajena.id } });
    expect(sigue?.listingId).toBeNull();
  });

  it('el staff valida IGUAL: el tope de fotos', async () => {
    const { listing, imagenes } = await crearConFotos(1, 'tope');
    await prisma.setting.upsert({
      where: { key: 'maxPhotosPerListing' },
      create: { key: 'maxPhotosPerListing', value: 2 },
      update: { value: 2 },
    });
    const sueltas = await Promise.all([
      crearSuelta(sellerId, 'tope-1'),
      crearSuelta(sellerId, 'tope-2'),
    ]);

    try {
      await request(server())
        .patch(`/api/admin/listings/${listing.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          imageIds: [imagenes[0].id, ...sueltas.map((s) => s.id)],
          reason: 'Tres fotos con el tope en dos',
        })
        .expect(422);

      expect(await ordenGuardado(listing.id)).toEqual([imagenes[0].id]);
    } finally {
      await prisma.setting.delete({ where: { key: 'maxPhotosPerListing' } });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // (4) EL DESVINCULADOR COMPARTIDO — la misma barrera, DOS veces
  // ───────────────────────────────────────────────────────────────────────────

  it('LA BARRERA (R2, staff): quitar una foto BORRA la fila y encola sus DOS claves', async () => {
    const { listing, imagenes } = await crearConFotos(2, 'r2-staff');
    const fuera = imagenes[1].id;

    await request(server())
      .patch(`/api/admin/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ imageIds: [imagenes[0].id], reason: 'Foto con datos de contacto' })
      .expect(200);

    // (a) LA FILA SE BORRA, no se desvincula: purgar el objeto dejando la fila daría algo
    // peor que antes — una fila apuntando a un fichero que ya no existe.
    expect(await prisma.listingImage.findUnique({ where: { id: fuera } })).toBeNull();

    // Y las DOS claves: el original y la miniatura derivada, que es la mitad que se
    // quedaba fuera cuando se miraba sólo la base de datos.
    expect(clavesEncoladas()).toEqual([
      'media/r2-staff-1-thumb.webp',
      'media/r2-staff-1.jpg',
    ]);
  });

  it('LA BARRERA (R2, DUEÑO): el mismo desvinculador, por el otro camino', async () => {
    // ÉSTE ES EL TEST QUE DEMUESTRA QUE ES COMPARTIDO. Con sólo el de arriba, «limpiar
    // únicamente en el camino de staff» pasaría — y ésa es la opción que la decisión
    // (§5.3) descartó por dejar abierta la fuga principal, que es justamente ésta.
    const { listing, imagenes } = await crearConFotos(2, 'r2-dueno');
    const fuera = imagenes[1].id;

    await request(server())
      .patch(`/api/listings/${listing.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ imageIds: [imagenes[0].id] })
      .expect(200);

    expect(await prisma.listingImage.findUnique({ where: { id: fuera } })).toBeNull();
    expect(clavesEncoladas()).toEqual([
      'media/r2-dueno-1-thumb.webp',
      'media/r2-dueno-1.jpg',
    ]);
  });

  it('no se encola nada si no sale ninguna foto', async () => {
    // Un `purge` con la lista vacía sería ruido en la cola, y peor: haría que el test de
    // arriba pasara por el motivo equivocado.
    const { listing, imagenes } = await crearConFotos(2, 'sin-cambios');

    await request(server())
      .patch(`/api/admin/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ imageIds: imagenes.map((i) => i.id), reason: 'Sólo cambio el orden' })
      .expect(200);

    expect(clavesEncoladas()).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // (b) LA TRAZA — irreversible, pero diagnosticable
  // ───────────────────────────────────────────────────────────────────────────

  it('el AuditLog dice QUÉ fotos se quitaron, con su URL', async () => {
    // Mientras quitar era reversible daba igual que `imageIds` no entrara en el registro.
    // Desde que el fichero se borra de R2, un error del staff es IRRECUPERABLE; sin esto
    // sería además INVISIBLE. No devuelve la foto: hace que se pueda saber cuál era.
    const { listing, imagenes } = await crearConFotos(2, 'traza');

    await request(server())
      .patch(`/api/admin/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ imageIds: [imagenes[0].id], reason: 'Quito la segunda' })
      .expect(200);

    const registro = await prisma.auditLog.findFirst({
      where: { action: 'LISTING_EDIT', resourceId: listing.id },
      orderBy: { createdAt: 'desc' },
    });
    const after = registro?.after as {
      imageIds?: string[];
      imagenesRetiradas?: { id: string; url: string }[];
    };

    expect(after.imageIds).toEqual([imagenes[0].id]);
    expect(after.imagenesRetiradas).toEqual([
      { id: imagenes[1].id, url: `${prefijo}media/traza-1.jpg` },
    ]);
  });

  it('una edición que NO toca las fotos no ensucia el registro con ellas', async () => {
    const { listing } = await crearConFotos(1, 'traza-sin-fotos');

    await request(server())
      .patch(`/api/admin/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'IMG traza titulo nuevo', reason: 'Sólo el título' })
      .expect(200);

    const registro = await prisma.auditLog.findFirst({
      where: { action: 'LISTING_EDIT', resourceId: listing.id },
      orderBy: { createdAt: 'desc' },
    });
    const after = registro?.after as Record<string, unknown>;
    expect(after).not.toHaveProperty('imageIds');
    expect(after).not.toHaveProperty('imagenesRetiradas');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EL CUIDADO DE P3a, que 2b no puede perder
  // ───────────────────────────────────────────────────────────────────────────

  it('quitar fotos desde el backoffice NO mueve la etiqueta interna', async () => {
    const { listing, imagenes } = await crearConFotos(2, 'triage');
    await prisma.listing.update({ where: { id: listing.id }, data: { triage: 'REVIEWED' } });

    await request(server())
      .patch(`/api/admin/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ imageIds: [imagenes[0].id], reason: 'Quito una foto' })
      .expect(200);

    const despues = await prisma.listing.findUnique({ where: { id: listing.id } });
    expect(despues?.triage).toBe('REVIEWED');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EL MÍNIMO — sólo sobre lo que YA ESTÁ EN EL MERCADO
  //
  // `MinPhotosRule` es una regla de PUERTA: mira al publicar y al aprobar, y en
  // ningún momento más. Eso dejaba un hueco que ninguna puerta puede cubrir —a un
  // ACTIVE se le podían quitar TODAS las fotos editándolo— y que el backoffice
  // convierte en alcanzable desde que manda `imageIds`.
  //
  // Los dos lados se fijan aquí, y el negativo importa tanto como el positivo: un
  // mínimo incondicional en el camino compartido impediría CREAR un borrador a
  // todos los vendedores, porque el asistente crea el DRAFT primero y sube las
  // fotos después.
  // ───────────────────────────────────────────────────────────────────────────

  /** Enciende o apaga el interruptor del mínimo (`minPhotosRuleEnabled`). */
  async function exigirMinimo(activo: boolean, min = 1) {
    await prisma.setting.upsert({
      where: { key: 'minPhotosRuleEnabled' },
      create: { key: 'minPhotosRuleEnabled', value: activo },
      update: { value: activo },
    });
    await prisma.setting.upsert({
      where: { key: 'minPhotosPerListing' },
      create: { key: 'minPhotosPerListing', value: min },
      update: { value: min },
    });
  }

  afterEach(async () => {
    // El interruptor vuelve APAGADO, que es como nace: dejarlo encendido cambiaría
    // el resultado de los tests de arriba, que quitan fotos de anuncios ACTIVE.
    await exigirMinimo(false);
  });

  it('LA BARRERA (mínimo): un ACTIVE no se queda por debajo — 422 NOT_ENOUGH_PHOTOS', async () => {
    await exigirMinimo(true, 1);
    const { listing, imagenes } = await crearConFotos(1, 'min-activo');

    const res = await request(server())
      .patch(`/api/admin/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ imageIds: [], reason: 'Intento dejarlo sin fotos' })
      .expect(422);

    // El código es el MISMO que da la puerta al publicar: no hay un cuarto sitio
    // donde viva el mínimo.
    expect(res.body.code).toBe('NOT_ENOUGH_PHOTOS');

    // Y se afirma contra el EFECTO, no contra el código de respuesta: la foto sigue
    // ahí y no se encoló ningún borrado.
    expect(await prisma.listingImage.findUnique({ where: { id: imagenes[0].id } })).not.toBeNull();
    expect(clavesEncoladas()).toEqual([]);
  });

  it('EL NEGATIVO (lo que protege a los vendedores): un DRAFT SÍ puede quedarse sin fotos', async () => {
    // El asistente crea el borrador y sube las fotos DESPUÉS: un DRAFT con cero es el
    // estado normal de todo anuncio que empieza. Un mínimo incondicional aquí —que es
    // el sitio por el que pasan los tres caminos— rompería la creación de borradores
    // de toda la plataforma. A un DRAFT sin fotos ya lo frena la puerta al publicar.
    await exigirMinimo(true, 1);
    const { listing, imagenes } = await crearConFotos(1, 'min-draft');
    await prisma.listing.update({ where: { id: listing.id }, data: { status: 'DRAFT' } });

    await request(server())
      .patch(`/api/listings/${listing.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ imageIds: [] })
      .expect(200);

    expect(await prisma.listingImage.findUnique({ where: { id: imagenes[0].id } })).toBeNull();
  });

  it('con el interruptor APAGADO (como nace) el mínimo no estorba a nadie', async () => {
    await exigirMinimo(false);
    const { listing } = await crearConFotos(1, 'min-apagado');

    await request(server())
      .patch(`/api/admin/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ imageIds: [], reason: 'La regla está apagada' })
      .expect(200);
  });

  it('el mínimo tampoco frena si quedan SUFICIENTES', async () => {
    await exigirMinimo(true, 2);
    const { listing, imagenes } = await crearConFotos(3, 'min-suficientes');

    await request(server())
      .patch(`/api/admin/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ imageIds: [imagenes[0].id, imagenes[1].id], reason: 'Quito la tercera' })
      .expect(200);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // LA FUGA DEL FICHERO COMPARTIDO
  // ───────────────────────────────────────────────────────────────────────────

  it('LA BARRERA (§7.3): quitar una de dos filas con la MISMA url no borra el fichero', async () => {
    // `listingMediaKeys` deduplica dentro de una llamada, pero eso sólo cubre mandar la
    // misma URL dos veces en el MISMO borrado. Con dos filas que comparten `url` —el
    // propio media-keys.ts contempla el caso— quitar una encolaba la clave del fichero
    // que la SUPERVIVIENTE sigue apuntando: una foto rota en una ficha viva, sin
    // ninguna forma de recuperarla. Nadie podía provocarlo mientras la interfaz no
    // mandara `imageIds`; desde esta ráfaga, sí.
    const { listing, imagenes } = await crearConFotos(1, 'compartida');
    const gemela = await prisma.listingImage.create({
      data: {
        listingId: listing.id,
        url: imagenes[0].url, // LA MISMA
        order: 1,
        uploadedById: sellerId,
      },
    });

    await request(server())
      .patch(`/api/admin/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ imageIds: [imagenes[0].id], reason: 'Quito la duplicada' })
      .expect(200);

    // La fila duplicada se va…
    expect(await prisma.listingImage.findUnique({ where: { id: gemela.id } })).toBeNull();
    // …pero el FICHERO no, porque la superviviente lo sigue usando.
    expect(clavesEncoladas()).toEqual([]);
    expect(await prisma.listingImage.findUnique({ where: { id: imagenes[0].id } })).not.toBeNull();
  });

  it('y cuando se van LAS DOS, el fichero sí se borra (una vez, no dos)', async () => {
    // El otro lado de la misma moneda: sin este caso, «no encolar nunca una url
    // repetida» también pasaría el test de arriba y dejaría basura para siempre.
    const { listing, imagenes } = await crearConFotos(1, 'compartida-ambas');
    await prisma.listingImage.create({
      data: {
        listingId: listing.id,
        url: imagenes[0].url,
        order: 1,
        uploadedById: sellerId,
      },
    });

    await request(server())
      .patch(`/api/admin/listings/${listing.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ imageIds: [], reason: 'Quito las dos' })
      .expect(200);

    expect(clavesEncoladas()).toEqual([
      'media/compartida-ambas-0-thumb.webp',
      'media/compartida-ambas-0.jpg',
    ]);
  });
});
