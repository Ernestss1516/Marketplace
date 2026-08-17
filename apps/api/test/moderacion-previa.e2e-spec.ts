/**
 * MODERACIÓN PREVIA — RÁFAGA M1: EL DISPARADOR.
 *
 * M1 sólo hace UNA cosa: decidir si un anuncio va a revisión y, si va, DESVIARLO
 * allí. Aprobarlo o rechazarlo es M2/M3 — aquí sólo se comprueba que el anuncio
 * llega a `PENDING_REVIEW` en vez de a `ACTIVE`, y que no se pierde por el camino.
 *
 * LOS DOS CASOS QUE SOSTIENEN TODO LO DEMÁS:
 *
 *  · APAGADO NO HACE NADA. Sin el ajuste de plataforma y sin ninguna categoría
 *    marcada, publicar se comporta exactamente igual que antes de esta ráfaga.
 *  · LA HERENCIA SUBE POR TODA LA CADENA. Un anuncio de NIVEL 4 cuya categoría no
 *    está marcada, pero cuyo ANCESTRO sí, tiene que ir a revisión. Es el riesgo
 *    R1 de la profundidad —un pliegue que sube un solo nivel no da error, sólo
 *    publica sin revisar— y por eso el caso va sobre el árbol de 4 niveles y no
 *    sobre el de 2 del seed, donde «el padre» y «la cadena» son lo mismo y
 *    ningún test los distinguiría.
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { createDeepCategoryTree, type DeepCategoryTree } from './helpers/deep-category-tree';
import { PRE_MODERATION_ALL_SETTING } from 'src/modules/moderation/pre-moderation.service';

/** La lista de palabras prohibidas: el OTRO camino a PENDING_REVIEW. */
const BAD_WORDS_SETTING = 'badWordList';

describe('Moderación previa M1 — el disparador (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let arbol: DeepCategoryTree;
  /** Categoría llana del seed (2 niveles), para los casos que no van de herencia. */
  let movilesId: string;
  let sellerId: string;
  let sellerToken: string;
  let adminToken: string;
  let badWordsOriginal: unknown;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    arbol = await createDeepCategoryTree(prisma, 'moder');
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    movilesId = cat.id;

    badWordsOriginal =
      (await prisma.setting.findUnique({ where: { key: BAD_WORDS_SETTING } }))?.value ?? null;

    const passwordHash = await bcrypt.hash('Test1234!', 4);
    const seller = await prisma.user.create({
      data: { email: 'moder-seller@example.com', name: 'Moder Seller', slug: 'moder-seller', passwordHash, emailVerified: true },
    });
    sellerId = seller.id;
    await prisma.user.create({
      data: { email: 'moder-admin@example.com', name: 'Moder Admin', slug: 'moder-admin', passwordHash, emailVerified: true, role: 'ADMIN' },
    });

    const [s, a] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'moder-seller@example.com', password: 'Test1234!' }),
      request(app.getHttpServer()).post('/api/auth/admin-login').send({ email: 'moder-admin@example.com', password: 'Test1234!' }),
    ]);
    sellerToken = s.body.accessToken as string;
    adminToken = a.body.accessToken as string;
  });

  afterEach(async () => {
    // Todo vuelve a APAGADO: es el estado de nacimiento y el que asume el resto
    // de la batería.
    await prisma.setting.deleteMany({ where: { key: PRE_MODERATION_ALL_SETTING } });
    await prisma.category.updateMany({
      where: { id: { in: [arbol.raiz.id, arbol.nivel2.id, arbol.nivel3.id, arbol.bisnieto.id, movilesId] } },
      data: { requiresReview: false },
    });
    await prisma.listing.deleteMany({ where: { sellerId } });
  });

  afterAll(async () => {
    // `badWordList` es dato de sistema compartido y `cleanDb` no lo limpia.
    if (badWordsOriginal === null) {
      await prisma.setting.deleteMany({ where: { key: BAD_WORDS_SETTING } });
    } else {
      await prisma.setting.upsert({
        where: { key: BAD_WORDS_SETTING },
        create: { key: BAD_WORDS_SETTING, value: badWordsOriginal as never },
        update: { value: badWordsOriginal as never },
      });
    }
    await app.close();
    await prisma.$disconnect();
  });

  // ===========================================================================
  // Utilidades
  // ===========================================================================

  async function encenderPlataforma(): Promise<void> {
    await prisma.setting.upsert({
      where: { key: PRE_MODERATION_ALL_SETTING },
      create: { key: PRE_MODERATION_ALL_SETTING, value: true },
      update: { value: true },
    });
  }

  async function marcarCategoria(id: string): Promise<void> {
    await prisma.category.update({ where: { id }, data: { requiresReview: true } });
  }

  let n = 0;
  async function seedDraft(categoryId: string, titulo = 'Anuncio limpio'): Promise<string> {
    n += 1;
    const l = await prisma.listing.create({
      data: {
        title: `${titulo} ${n}`,
        slug: `moderacion-${n}-${Date.now()}`,
        description: 'Descripción sin nada raro',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        // El árbol profundo restringe el formato de precio en el nivel 2 y el
        // tipo en la raíz; se siembra por Prisma para no pelearse con eso, que es
        // de otra ráfaga.
        priceUnit: categoryId === movilesId ? 'ONE_TIME' : 'PER_MONTH',
        status: ListingStatus.DRAFT,
        sellerId,
        categoryId,
      },
      select: { id: true },
    });
    return l.id;
  }

  function publicar(id: string) {
    return request(app.getHttpServer())
      .post(`/api/listings/${id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`);
  }

  async function estado(id: string): Promise<ListingStatus> {
    const l = await prisma.listing.findUniqueOrThrow({ where: { id }, select: { status: true } });
    return l.status;
  }

  // ===========================================================================
  // 1 · APAGADO — el requisito de oro
  // ===========================================================================

  describe('Apagado (como nace)', () => {
    it('publicar sigue llevando a ACTIVE, en el árbol llano y en el profundo', async () => {
      const llano = await seedDraft(movilesId);
      const profundo = await seedDraft(arbol.bisnieto.id);

      expect((await publicar(llano).expect(200)).body.status).toBe('ACTIVE');
      expect((await publicar(profundo).expect(200)).body.status).toBe('ACTIVE');
    });
  });

  // ===========================================================================
  // 2 · NIVEL PLATAFORMA
  // ===========================================================================

  describe('Nivel plataforma', () => {
    it('encendido: TODO anuncio va a revisión', async () => {
      const id = await seedDraft(movilesId);
      await encenderPlataforma();

      const res = await publicar(id).expect(200);
      expect(res.body.status).toBe('PENDING_REVIEW');
      expect(await estado(id)).toBe(ListingStatus.PENDING_REVIEW);
    });

    it('el anuncio desviado NO se activa ni se pierde: queda esperando', async () => {
      const id = await seedDraft(movilesId);
      await encenderPlataforma();
      await publicar(id).expect(200);

      const fila = await prisma.listing.findUniqueOrThrow({
        where: { id },
        select: { status: true, publishedAt: true, expiresAt: true },
      });
      expect(fila.status).toBe(ListingStatus.PENDING_REVIEW);
      // `publishedAt` sí se fija (el vendedor pulsó publicar); `expiresAt` NO,
      // porque el reloj de caducidad arranca al aprobarlo. Es el comportamiento
      // que ya tenía el camino del filtro de palabras, sin cambios.
      expect(fila.publishedAt).not.toBeNull();
      expect(fila.expiresAt).toBeNull();
    });
  });

  // ===========================================================================
  // 3 · NIVEL CATEGORÍA, Y EL PLIEGUE MONÓTONO (R1)
  // ===========================================================================

  describe('Nivel categoría', () => {
    it('la categoría PROPIA marcada manda su anuncio a revisión', async () => {
      const id = await seedDraft(movilesId);
      await marcarCategoria(movilesId);

      expect((await publicar(id).expect(200)).body.status).toBe('PENDING_REVIEW');
    });

    it('R1 — un ANCESTRO marcado alcanza al anuncio del NIVEL 4', async () => {
      // EL CASO QUE JUSTIFICA EL FIXTURE PROFUNDO. La categoría del anuncio (nivel
      // 4) NO está marcada, y su padre (nivel 3) tampoco: la marca está dos
      // niveles más arriba. Un disparador que mire sólo la categoría propia —o
      // sólo su padre— publicaría esto sin revisar, y con un árbol de dos niveles
      // ningún test lo distinguiría.
      const id = await seedDraft(arbol.bisnieto.id);
      await marcarCategoria(arbol.nivel2.id);

      expect((await publicar(id).expect(200)).body.status).toBe('PENDING_REVIEW');
    });

    it('R1 — también desde la RAÍZ, tres niveles por encima', async () => {
      const id = await seedDraft(arbol.bisnieto.id);
      await marcarCategoria(arbol.raiz.id);

      expect((await publicar(id).expect(200)).body.status).toBe('PENDING_REVIEW');
    });

    it('MONÓTONO: el descendiente no puede aflojar lo que marcó el ancestro', async () => {
      // Se pide explícitamente desmarcar la hoja mientras la raíz está marcada.
      // El pliegue tiene que seguir diciendo «revisar»: no hay valor que un
      // descendiente pueda poner para desdecir a un ancestro.
      const id = await seedDraft(arbol.bisnieto.id);
      await marcarCategoria(arbol.raiz.id);
      await request(app.getHttpServer())
        .patch(`/api/admin/categories/${arbol.bisnieto.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ requiresReview: false })
        .expect(200);

      expect((await publicar(id).expect(200)).body.status).toBe('PENDING_REVIEW');
    });

    it('una rama marcada NO afecta a otra rama', async () => {
      // Control negativo: sin él, un disparador que devolviera siempre `true`
      // pasaría todos los casos de arriba.
      const enOtraRama = await seedDraft(movilesId);
      await marcarCategoria(arbol.raiz.id);

      expect((await publicar(enOtraRama).expect(200)).body.status).toBe('ACTIVE');
    });

    it('la marca se puede poner y quitar desde la API de admin', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/categories/${movilesId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ requiresReview: true })
        .expect(200);
      expect((await publicar(await seedDraft(movilesId)).expect(200)).body.status).toBe(
        'PENDING_REVIEW',
      );

      await request(app.getHttpServer())
        .patch(`/api/admin/categories/${movilesId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ requiresReview: false })
        .expect(200);
      expect((await publicar(await seedDraft(movilesId)).expect(200)).body.status).toBe('ACTIVE');
    });
  });

  // ===========================================================================
  // 4 · CONVIVENCIA con el filtro de palabras
  // ===========================================================================

  describe('Convive con el filtro de palabras', () => {
    async function fijarPalabras(palabras: string[]): Promise<void> {
      await prisma.setting.upsert({
        where: { key: BAD_WORDS_SETTING },
        create: { key: BAD_WORDS_SETTING, value: palabras as never },
        update: { value: palabras as never },
      });
    }

    it('el filtro sigue mandando a revisión por su cuenta, con todo apagado', async () => {
      await fijarPalabras(['prohibidísima']);
      const id = await seedDraft(movilesId, 'Vendo cosa prohibidísima');

      expect((await publicar(id).expect(200)).body.status).toBe('PENDING_REVIEW');
    });

    it('los dos a la vez no se pisan: sigue siendo UNA revisión', async () => {
      await fijarPalabras(['prohibidísima']);
      await encenderPlataforma();
      const id = await seedDraft(movilesId, 'Vendo cosa prohibidísima');

      expect((await publicar(id).expect(200)).body.status).toBe('PENDING_REVIEW');
    });

    it('un texto limpio con el filtro configurado y todo apagado → ACTIVE', async () => {
      // El filtro no marca de más, y el disparador apagado tampoco.
      await fijarPalabras(['prohibidísima']);
      const id = await seedDraft(movilesId);

      expect((await publicar(id).expect(200)).body.status).toBe('ACTIVE');
    });
  });
});
