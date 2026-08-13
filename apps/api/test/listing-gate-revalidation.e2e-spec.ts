/**
 * PUERTA — RÁFAGA 2. `needsRevalidation` DE PUNTA A PUNTA.
 *
 * La historia completa, en el orden en que le pasa a un vendedor real:
 *
 *   1. Publica un anuncio que cumple. Todo normal.
 *   2. Un administrador cambia el schema de una categoría ANCESTRA y el anuncio
 *      deja de cumplir sin que su dueño haya tocado nada.
 *   3. El anuncio queda MARCADO — pero sigue ACTIVE, sigue en el índice y sigue
 *      encontrándose. No desaparece de golpe.
 *   4. El vendedor ve el aviso en «Mis anuncios», CON los motivos.
 *   5. Con la regla ENCENDIDA, la puerta lo frena en la siguiente transición.
 *      Con la regla APAGADA —que es como nace— no frena a nadie.
 *   6. El vendedor lo corrige editando, y el aviso desaparece solo.
 *
 * SOBRE EL FIXTURE: se usa el árbol de 4 niveles y se toca el schema del NIVEL 2
 * para invalidar un anuncio que cuelga del NIVEL 4. Con un árbol de 2 niveles el
 * test pasaría igual con una herencia rota, que es justo lo que no se quiere.
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb } from './helpers/db';
import { waitForIndex } from './helpers/meili';
import { pollUntil } from './helpers/poll';
import { createDeepCategoryTree, type DeepCategoryTree } from './helpers/deep-category-tree';
import { ATTRIBUTE_RULE_ENABLED_SETTING } from 'src/modules/listing-gate/rules/attribute-revalidation.rule';

describe('Puerta — needsRevalidation de punta a punta (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  let arbol: DeepCategoryTree;
  let sellerId: string;
  let sellerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    arbol = await createDeepCategoryTree(prisma, 'reval');

    const passwordHash = await bcrypt.hash('Test1234!', 4);
    const seller = await prisma.user.create({
      data: { email: 'reval-seller@example.com', name: 'Reval Seller', slug: 'reval-seller', passwordHash, emailVerified: true },
    });
    sellerId = seller.id;
    await prisma.user.create({
      data: { email: 'reval-admin@example.com', name: 'Reval Admin', slug: 'reval-admin', passwordHash, emailVerified: true, role: 'ADMIN' },
    });

    const [s, a] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'reval-seller@example.com', password: 'Test1234!' }),
      request(app.getHttpServer()).post('/api/auth/admin-login').send({ email: 'reval-admin@example.com', password: 'Test1234!' }),
    ]);
    sellerToken = s.body.accessToken as string;
    adminToken = a.body.accessToken as string;
  });

  /**
   * TODO SE DESHACE AQUÍ, y no al final de cada caso: un `await restaurar…()`
   * escrito como última línea del test NO CORRE si el test falla antes, y
   * entonces el siguiente arranca con el schema cambiado. Se vio al hacer
   * verificación por mutación: una mutación tumbó siete tests, y el octavo cayó
   * en cadena por contaminación, no por la mutación. Un fallo que arrastra a los
   * siguientes esconde qué se rompió de verdad.
   */
  afterEach(async () => {
    // La regla vuelve a su estado de nacimiento —APAGADA—.
    await prisma.setting.deleteMany({ where: { key: ATTRIBUTE_RULE_ENABLED_SETTING } });
    // El vendedor se queda sin anuncios: acumularlos entre casos acabaría
    // topando con la CUOTA de activos, que es del grupo `entrada` y corta antes
    // de que la regla de atributos —lo que aquí se prueba— llegue a mirar nada.
    // Se veía como un 403 donde se esperaba un 422.
    await prisma.listing.deleteMany({ where: { sellerId } });
    // Y el schema del nivel 2 vuelve al del fixture.
    await restaurarNivel2();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ===========================================================================
  // Utilidades
  // ===========================================================================

  async function encenderRegla(): Promise<void> {
    await prisma.setting.upsert({
      where: { key: ATTRIBUTE_RULE_ENABLED_SETTING },
      create: { key: ATTRIBUTE_RULE_ENABLED_SETTING, value: true },
      update: { value: true },
    });
  }

  let n = 0;
  /** Un anuncio en la HOJA del árbol de 4 niveles, con los atributos que se le pasen. */
  async function seedListing(
    attributes: Record<string, unknown>,
    status: ListingStatus = ListingStatus.ACTIVE,
  ): Promise<{ id: string; slug: string }> {
    n += 1;
    return prisma.listing.create({
      data: {
        title: `Revalidación ${n}`,
        slug: `revalidacion-${n}-${Date.now()}`,
        description: 'Anuncio de la suite de revalidación',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status,
        sellerId,
        categoryId: arbol.bisnieto.id,
        attributes: attributes as Prisma.InputJsonValue,
        ...(status === ListingStatus.ACTIVE || status === ListingStatus.EXPIRED
          ? { publishedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 86_400_000) }
          : {}),
      },
      select: { id: true, slug: true },
    });
  }

  /** El PATCH de admin que invalida: añade un atributo REQUERIDO al nivel 2. */
  async function exigirAtributoEnNivel2(name: string): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/api/admin/categories/${arbol.nivel2.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        attributeSchema: [
          { name: 'deNivel2', label: 'Sólo del nivel 2', type: 'text', filterable: true, required: false },
          { name, label: 'Obligatorio nuevo', type: 'text', filterable: false, required: true },
        ],
      })
      .expect(200);
  }

  /** Devuelve el schema del nivel 2 a como estaba, para no contaminar otros tests. */
  async function restaurarNivel2(): Promise<void> {
    await request(app.getHttpServer())
      .patch(`/api/admin/categories/${arbol.nivel2.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        attributeSchema: [
          { name: 'deNivel2', label: 'Sólo del nivel 2', type: 'text', filterable: true, required: false },
        ],
      })
      .expect(200);
  }

  async function marcado(id: string): Promise<boolean> {
    const l = await prisma.listing.findUniqueOrThrow({
      where: { id },
      select: { needsRevalidation: true },
    });
    return l.needsRevalidation;
  }

  async function esperarMarcado(id: string, esperado = true): Promise<void> {
    await pollUntil(async () => (await marcado(id)) === esperado);
  }

  // ===========================================================================
  // 1 · EL MARCADO — y lo que NO cambia al marcar
  // ===========================================================================

  describe('El marcado por cambio de schema', () => {
    it('marca los anuncios que dejan de cumplir, HEREDANDO desde 2 niveles más arriba', async () => {
      const roto = await seedListing({});
      const cumple = await seedListing({ nuevoRequerido: 'lo tengo' });

      await exigirAtributoEnNivel2('nuevoRequerido');

      // El anuncio cuelga del NIVEL 4 y el cambio es del NIVEL 2: sin herencia
      // plegada, este anuncio no se marcaría nunca.
      await esperarMarcado(roto.id, true);
      // Y no se marca por barrer: el que sí cumple se queda como estaba.
      expect(await marcado(cumple.id)).toBe(false);

    });

    it('NO saca el anuncio de ACTIVE y NO lo quita del índice — sigue encontrándose', async () => {
      // Se publica POR LA API para que se indexe por el camino de siempre, en
      // vez de sembrarlo con Prisma: lo que se quiere comprobar es que un
      // anuncio realmente indexado sigue estándolo después de marcarlo.
      const creado = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Revalidación indexado',
          description: 'Anuncio que debe seguir en el índice tras marcarse',
          price: 10,
          type: 'PRODUCT',
          priceType: 'FIXED',
          // El nivel 2 del fixture sólo permite PER_MONTH, y la hoja lo hereda:
          // mandar el ONE_TIME por defecto sería un 422 por otro motivo.
          priceUnit: 'PER_MONTH',
          condition: 'GOOD',
          categoryId: arbol.bisnieto.id,
          city: 'Madrid',
          province: 'Madrid',
          latitude: 40.4168,
          longitude: -3.7038,
        })
        .expect(201);
      const roto = { id: creado.body.id as string, slug: creado.body.slug as string };

      await request(app.getHttpServer())
        .post(`/api/listings/${roto.id}/publish`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
      await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, roto.id);

      await exigirAtributoEnNivel2('nuevoRequerido');
      await esperarMarcado(roto.id, true);

      // (1) SIGUE ACTIVE — el flag es ortogonal al ciclo de vida.
      const fila = await prisma.listing.findUniqueOrThrow({
        where: { id: roto.id },
        select: { status: true },
      });
      expect(fila.status).toBe(ListingStatus.ACTIVE);

      // (2) EL FLAG NO ENTRA EN EL DOCUMENTO. Si alguien lo añadiera a
      // `ListingDocument`, marcar pasaría a exigir un reindexado de todo el
      // subárbol — justo el coste que esta política evita.
      // Se pide SIN `catch`: si el marcado hubiera sacado el documento del
      // índice, esto lanzaría, que es exactamente el fallo que se quiere ver.
      const doc = (await meili
        .index(process.env.MEILI_INDEX_NAME!)
        .getDocument(roto.id)) as Record<string, unknown>;
      expect(doc).not.toHaveProperty('needsRevalidation');

      // (3) SIGUE SIENDO PÚBLICO: la ficha responde con normalidad.
      await request(app.getHttpServer()).get(`/api/listings/${roto.slug}`).expect(200);

    });

    it('un cambio de schema que NO invalida a nadie no marca nada', async () => {
      const cumple = await seedListing({});

      await request(app.getHttpServer())
        .patch(`/api/admin/categories/${arbol.nivel2.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          attributeSchema: [
            { name: 'deNivel2', label: 'Renombrado pero opcional', type: 'text', filterable: true, required: false },
          ],
        })
        .expect(200);

      // Se espera al mismo trabajo que en los otros casos y se comprueba que
      // NO marcó: sin esta espera el test sería verde por llegar antes que el job.
      await pollUntil(async () => {
        const l = await prisma.listing.findUniqueOrThrow({
          where: { id: cumple.id },
          select: { needsRevalidation: true, updatedAt: true },
        });
        return l.needsRevalidation === false;
      });
      expect(await marcado(cumple.id)).toBe(false);
    });
  });

  // ===========================================================================
  // 2 · EL AVISO al vendedor
  // ===========================================================================

  it('«Mis anuncios» trae el flag Y los motivos, para que el aviso lleve a la solución', async () => {
    const roto = await seedListing({ sobra: 'clave huérfana' });
    await exigirAtributoEnNivel2('nuevoRequerido');
    await esperarMarcado(roto.id, true);

    const res = await request(app.getHttpServer())
      .get('/api/users/me/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    const item = (res.body.items as Array<Record<string, unknown>>).find((i) => i.id === roto.id);
    expect(item?.needsRevalidation).toBe(true);
    const motivos = item?.revalidationReasons as Array<{ code: string; field: string; message: string }>;
    // Los DOS problemas, no el primero: el requerido que falta y la clave que sobra.
    expect(motivos.map((m) => m.code).sort()).toEqual([
      'ATTRIBUTE_REQUIRED_MISSING',
      'ATTRIBUTE_UNKNOWN',
    ]);
    expect(motivos.every((m) => m.message.length > 0 && m.field.length > 0)).toBe(true);

  });

  // ===========================================================================
  // 3 · EL FRENO — y que `enabled` es quien lo gobierna
  // ===========================================================================

  describe('El freno depende de `enabled`', () => {
    it('APAGADA (como nace): un anuncio marcado renueva sin problema', async () => {
      const roto = await seedListing({}, ListingStatus.EXPIRED);
      await exigirAtributoEnNivel2('nuevoRequerido');
      await esperarMarcado(roto.id, true);

      await request(app.getHttpServer())
        .post(`/api/listings/${roto.id}/renew`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      // Y sigue marcado: pasar con la regla apagada NO es prueba de que cumpla,
      // así que el aviso no se retira.
      expect(await marcado(roto.id)).toBe(true);

    });

    it('ENCENDIDA: la puerta frena, con TODOS los motivos y un 422', async () => {
      const roto = await seedListing({ sobra: 'clave huérfana' }, ListingStatus.EXPIRED);
      await exigirAtributoEnNivel2('nuevoRequerido');
      await esperarMarcado(roto.id, true);
      await encenderRegla();

      const res = await request(app.getHttpServer())
        .post(`/api/listings/${roto.id}/renew`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(422);

      expect(res.body.code).toBe('LISTING_NOT_VALID');
      expect(res.body.reasons).toHaveLength(2);
      expect((res.body.reasons as Array<{ code: string }>).map((r) => r.code).sort()).toEqual([
        'ATTRIBUTE_REQUIRED_MISSING',
        'ATTRIBUTE_UNKNOWN',
      ]);
      // No se activó.
      const fila = await prisma.listing.findUniqueOrThrow({
        where: { id: roto.id },
        select: { status: true },
      });
      expect(fila.status).toBe(ListingStatus.EXPIRED);

    });

    it('ENCENDIDA: bump sólo mira a los MARCADOS — un anuncio sin marcar no paga peaje', async () => {
      // Este anuncio incumple (le falta el requerido) pero NO está marcado.
      // Promocionar no es publicar: la regla no revalida el universo entero.
      const sinMarcar = await seedListing({});
      await exigirAtributoEnNivel2('nuevoRequerido');
      await esperarMarcado(sinMarcar.id, true);
      // Se desmarca a mano para construir el caso «incumple pero no marcado».
      await prisma.listing.update({
        where: { id: sinMarcar.id },
        data: { needsRevalidation: false },
      });
      await encenderRegla();

      // Sin saldo ni créditos el bump falla por otra razón; lo que importa es que
      // NO falle por la puerta.
      const res = await request(app.getHttpServer())
        .post(`/api/listings/${sinMarcar.id}/bump`)
        .set('Authorization', `Bearer ${sellerToken}`);
      expect(res.body.code).not.toBe('LISTING_NOT_VALID');

    });
  });

  // ===========================================================================
  // 4 · LA SALIDA — corregir limpia el aviso, y editar nunca frena
  // ===========================================================================

  describe('La corrección se premia sola', () => {
    it('editar un anuncio marcado NO se frena, y al quedar correcto limpia el aviso', async () => {
      const roto = await seedListing({});
      await exigirAtributoEnNivel2('nuevoRequerido');
      await esperarMarcado(roto.id, true);
      // Encendida: si editar pasara por la puerta, este PATCH sería un 422 y el
      // vendedor quedaría encerrado — no puede publicar porque no cumple, y no
      // puede arreglarlo porque no le dejan editar.
      await encenderRegla();

      await request(app.getHttpServer())
        .patch(`/api/listings/${roto.id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ attributes: { nuevoRequerido: 'ya está' } })
        .expect(200);

      expect(await marcado(roto.id)).toBe(false);

    });

    it('la puerta limpia el aviso de un anuncio que ya cumple, aunque la regla esté APAGADA', async () => {
      // Marcado a mano sobre un anuncio que SÍ cumple: es el caso de un marcado
      // que quedó obsoleto (la categoría volvió atrás, otro cambio lo arregló…).
      const bueno = await seedListing({}, ListingStatus.PAUSED);
      await prisma.listing.update({
        where: { id: bueno.id },
        data: { needsRevalidation: true },
      });

      await request(app.getHttpServer())
        .post(`/api/listings/${bueno.id}/reactivate`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      // Si la limpieza dependiera de `enabled`, este aviso se quedaría pegado
      // para siempre en un anuncio que cumple.
      expect(await marcado(bueno.id)).toBe(false);
    });
  });
});
