/**
 * PROFUNDIDAD N — RÁFAGA 1, e2e. La herencia sobre una cadena REAL de 4 niveles.
 *
 * QUÉ PRUEBA ESTO QUE NO PRUEBE EL FIXTURE PURO
 * (`src/modules/categories/category.types.depth.spec.ts`): aquel comprueba que
 * el PLIEGUE compone bien sobre objetos en memoria. Este comprueba lo que aquel
 * no puede — que la CADENA se carga de verdad desde Postgres y llega hasta la
 * respuesta de la API, pasando por `CategoryTreeService` y por los llamantes
 * reales (`GET /categories/:slug`, `POST /listings`).
 *
 * POR QUÉ 4 NIVELES: con datos de 2, «subir un nivel» y «plegar la cadena» dan
 * el MISMO resultado, así que ninguna aserción los distingue. El fixture de 4
 * niveles es lo único que hace visible R1 (la herencia rota en silencio).
 *
 * La MUTACIÓN que valida esta suite: truncar `getAncestorChain` a un solo salto
 * hace fallar las aserciones de herencia — no las de retrocompatibilidad. Eso es
 * lo que demuestra que están mirando la profundidad y no otra cosa.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { createDeepCategoryTree, type DeepCategoryTree } from './helpers/deep-category-tree';
import { CategoryTreeService } from 'src/modules/categories/category-tree.service';

describe('Profundidad N — herencia sobre 4 niveles (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tree: DeepCategoryTree;
  let treeService: CategoryTreeService;
  let adminToken: string;
  let sellerToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    // Se crea DESPUÉS de app.init() para que la barrera 2
    // (reset-categories-between-suites) ya tenga su foto y luego lo limpie.
    tree = await createDeepCategoryTree(prisma, 'e2e');
    treeService = app.get(CategoryTreeService);
    // El árbol memoizado pudo calentarse durante el arranque, antes de que
    // existieran estas categorías. En producción invalida `AdminService` al
    // crearlas; aquí se han creado por Prisma directo, así que se invalida a mano.
    treeService.invalidate();

    const passwordHash = await bcrypt.hash('Test1234!', 4);
    await prisma.user.create({
      data: {
        email: 'prof-admin@example.com',
        name: 'Prof Admin',
        slug: 'prof-admin',
        passwordHash,
        emailVerified: true,
        role: 'ADMIN',
      },
    });
    await prisma.user.create({
      data: {
        email: 'prof-seller@example.com',
        name: 'Prof Seller',
        slug: 'prof-seller',
        passwordHash,
        emailVerified: true,
      },
    });

    const [a, s] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'prof-admin@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'prof-seller@example.com', password: 'Test1234!' }),
    ]);
    adminToken = a.body.accessToken as string;
    sellerToken = s.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ===========================================================================
  // El lector
  // ===========================================================================

  describe('CategoryTreeService — el único lector', () => {
    it('getAncestorChain devuelve los 4 niveles, de la raíz a la hoja', async () => {
      const cadena = await treeService.getAncestorChain(tree.bisnieto.id);
      expect(cadena.map((n) => n.slug)).toEqual([
        tree.raiz.slug,
        tree.nivel2.slug,
        tree.nivel3.slug,
        tree.bisnieto.slug,
      ]);
    });

    it('una raíz es una cadena de un solo elemento', async () => {
      const cadena = await treeService.getAncestorChain(tree.raiz.id);
      expect(cadena.map((n) => n.slug)).toEqual([tree.raiz.slug]);
    });

    it('getDepth cuenta la raíz como nivel 1', async () => {
      expect(await treeService.getDepth(tree.raiz.id)).toBe(1);
      expect(await treeService.getDepth(tree.bisnieto.id)).toBe(4);
    });

    it('getDescendantIds baja hasta el último nivel, no sólo a los hijos directos', async () => {
      const ids = await treeService.getDescendantIds(tree.raiz.id);
      expect(ids.sort()).toEqual([tree.nivel2.id, tree.nivel3.id, tree.bisnieto.id].sort());
    });

    it('una categoría inexistente da una cadena vacía, no una excepción', async () => {
      expect(await treeService.getAncestorChain('no-existe')).toEqual([]);
    });
  });

  // ===========================================================================
  // R1 — la herencia que sólo se ve con más de 2 niveles
  // ===========================================================================

  describe('R1 — GET /categories/:slug sobre el bisnieto (nivel 4)', () => {
    async function ficha(slug: string) {
      const res = await request(app.getHttpServer()).get(`/api/categories/${slug}`).expect(200);
      return res.body;
    }

    it('[1] hereda un atributo definido sólo en la RAÍZ (3 niveles más arriba)', async () => {
      const body = await ficha(tree.bisnieto.slug);
      const nombres = (body.attributeSchema as { name: string }[]).map((f) => f.name);
      expect(nombres).toContain('deRaiz');
    });

    it('[1b] acumula los atributos de los CUATRO niveles', async () => {
      const body = await ficha(tree.bisnieto.slug);
      const nombres = (body.attributeSchema as { name: string }[]).map((f) => f.name).sort();
      expect(nombres).toEqual(['deBisnieto', 'deNivel2', 'deNivel3', 'deRaiz', 'redefinido'].sort());
    });

    it('[2] el atributo redefinido en el NIVEL 3 pisa al de la raíz, y no sale duplicado', async () => {
      const body = await ficha(tree.bisnieto.slug);
      const campos = (body.attributeSchema as { name: string; label: string }[]).filter(
        (f) => f.name === 'redefinido',
      );
      expect(campos).toHaveLength(1);
      expect(campos[0].label).toBe('Etiqueta del NIVEL 3');
    });

    it('[3] la política restringida en la RAÍZ alcanza al bisnieto', async () => {
      const body = await ficha(tree.bisnieto.slug);
      expect(body.allowedListingType).toBe('PRODUCT_ONLY');
    });

    it('[4] vistas y formatos configurados en el NIVEL 2 llegan al nivel 4', async () => {
      const body = await ficha(tree.bisnieto.slug);
      expect(body.allowedViews).toEqual(['LISTA', 'MAPA']);
      expect(body.defaultView).toBe('MAPA');
      expect(body.allowedPriceUnits).toEqual(['PER_MONTH']);
    });

    it('[3b] la política de la raíz se aplica al PUBLICAR en el bisnieto', async () => {
      // La raíz es PRODUCT_ONLY: un SERVICE en la hoja debe rechazarse. Con una
      // resolución de un salto, el nivel 4 vería BOTH (su padre, el nivel 3) y
      // el anuncio se crearía — el fallo silencioso, hecho visible.
      const res = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Servicio en categoría PRODUCT_ONLY heredado del abuelo',
          description: 'Debe rechazarse por la política de la raíz',
          price: 10,
          type: 'SERVICE',
          priceType: 'FIXED',
          priceUnit: 'PER_MONTH',
          categoryId: tree.bisnieto.id,
          city: 'Madrid',
          province: 'Madrid',
        })
        .expect(422);
      expect(res.body.message).toContain('SERVICE');
    });

    it('[4b] el formato de precio del NIVEL 2 se aplica al publicar en el bisnieto', async () => {
      // El nivel 2 permite sólo PER_MONTH. ONE_TIME (el default global) debe
      // rechazarse en la hoja: sólo ocurre si el formato se hereda 2 niveles.
      await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Producto con formato no permitido dos niveles más arriba',
          description: 'Debe rechazarse por el formato heredado del nivel 2',
          price: 10,
          type: 'PRODUCT',
          condition: 'GOOD',
          priceType: 'FIXED',
          priceUnit: 'ONE_TIME',
          categoryId: tree.bisnieto.id,
          city: 'Madrid',
          province: 'Madrid',
        })
        .expect(422);
    });

    it('[1c] un anuncio válido en el bisnieto se crea con los atributos de toda la cadena', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Producto válido en el nivel 4',
          description: 'Usa atributos definidos en los cuatro niveles',
          price: 100,
          type: 'PRODUCT',
          condition: 'GOOD',
          priceType: 'FIXED',
          priceUnit: 'PER_MONTH',
          categoryId: tree.bisnieto.id,
          attributes: {
            deRaiz: 'valor de la raíz',
            deNivel2: 'valor del nivel 2',
            deNivel3: 'valor del nivel 3',
            deBisnieto: 'valor de la hoja',
            redefinido: 'valor del redefinido',
          },
          city: 'Madrid',
          province: 'Madrid',
        })
        .expect(201);
      // Si la herencia subiera un solo nivel, `deRaiz` y `deNivel2` serían
      // «Atributos no reconocidos» (422) en vez de guardarse.
      expect(res.body.attributes).toMatchObject({ deRaiz: 'valor de la raíz' });
    });
  });

  // ===========================================================================
  // El tope
  // ===========================================================================

  describe('[10] CATEGORY_MAX_DEPTH — la guarda de creación', () => {
    it('crear un QUINTO nivel se rechaza con el tope en el mensaje', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Quinto nivel',
          slug: `quinto-${tree.sufijo}`,
          parentId: tree.bisnieto.id,
        })
        .expect(400);
      expect(res.body.message).toContain('4 niveles');
    });

    it('crear el CUARTO nivel sí se permite (el tope es 4, no 3)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Otro cuarto nivel',
          slug: `otro-cuarto-${tree.sufijo}`,
          parentId: tree.nivel3.id,
        })
        .expect(201);
      expect(res.body.parentId).toBe(tree.nivel3.id);
    });
  });

  // ===========================================================================
  // No re-parentar (formalizado)
  // ===========================================================================

  describe('No re-parentar', () => {
    it('PATCH con `parentId` se RECHAZA con 400: el padre es inmutable', async () => {
      // La garantía es más fuerte que «se ignora»: el ValidationPipe global va
      // con `forbidNonWhitelisted`, y `UpdateCategoryDto` no declara `parentId`,
      // así que un intento de re-parentar no se cuela en silencio — se rechaza.
      // Eso es lo que mantiene estables las URLs de categoría (riesgo SEO cero)
      // y lo que permite que la guarda de tope sea de UNA sola regla. Ver el
      // comentario de cabecera de UpdateCategoryDto.
      await request(app.getHttpServer())
        .patch(`/api/admin/categories/${tree.bisnieto.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Bisnieto renombrado', parentId: tree.raiz.id })
        .expect(400);

      const enBd = await prisma.category.findUniqueOrThrow({
        where: { id: tree.bisnieto.id },
        select: { parentId: true, name: true },
      });
      expect(enBd.parentId).toBe(tree.nivel3.id);
    });

    it('el mismo PATCH sin `parentId` sí pasa: lo que se rechaza es re-parentar', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/categories/${tree.bisnieto.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Bisnieto renombrado' })
        .expect(200);

      const enBd = await prisma.category.findUniqueOrThrow({
        where: { id: tree.bisnieto.id },
        select: { parentId: true, name: true },
      });
      expect(enBd.name).toBe('Bisnieto renombrado');
      expect(enBd.parentId).toBe(tree.nivel3.id);
    });
  });

  // ===========================================================================
  // Retrocompatibilidad: los 2 niveles del seed siguen igual
  // ===========================================================================

  describe('Retrocompatibilidad — el árbol de 2 niveles del seed no cambia', () => {
    it('una hija de 2 niveles sigue heredando exactamente lo de su raíz', async () => {
      // `coches` cuelga de `vehiculos`, que define year+km (required).
      const res = await request(app.getHttpServer()).get('/api/categories/coches').expect(200);
      const nombres = (res.body.attributeSchema as { name: string }[]).map((f) => f.name);
      expect(nombres).toEqual(expect.arrayContaining(['year', 'km', 'brand']));
      expect(res.body.parent).toMatchObject({ slug: 'vehiculos' });
    });

    it('una raíz sin config propia sigue cayendo a los defaults globales', async () => {
      const res = await request(app.getHttpServer()).get('/api/categories/vehiculos').expect(200);
      expect(res.body.allowedViews).toEqual(['LISTA', 'AMPLIADA', 'MAPA']);
      expect(res.body.defaultView).toBe('LISTA');
      expect(res.body.allowedPriceUnits).toEqual(['ONE_TIME']);
      expect(res.body.parent).toBeNull();
    });
  });
});
