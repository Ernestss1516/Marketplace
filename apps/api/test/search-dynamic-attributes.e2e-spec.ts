/**
 * RÁFAGA 0 (producto/servicio, saneamiento previo) — atributos filtrables
 * dinámicos.
 *
 * VARIABLE_ATTRIBUTE_KEYS (constante hardcodeada) fue reemplazada por
 * FilterableAttributesResolver, que deriva las claves filtrables de
 * Category.attributeSchema. Este spec cubre el punto exacto que cambió de
 * MECANISMO: antes, el pipe global (forbidNonWhitelisted) rechazaba con 400
 * cualquier query param no declarado como campo de SearchQueryDto; ahora esa
 * responsabilidad la tiene search-query.parser.ts comparando contra el mapa
 * dinámico. El comportamiento observable debe ser idéntico.
 *
 * El mapa se resuelve UNA VEZ al arrancar el proceso (sin refresco en
 * caliente) — por eso la categoría propia de este spec (con su atributo
 * boolean) se crea ANTES de app.init(), igual que se reordenó en
 * rc5-attributes.e2e-spec.ts y rc5b-vehiculos.e2e-spec.ts.
 *
 * rc5-attributes.e2e-spec.ts, rc5b-vehiculos.e2e-spec.ts y search.e2e-spec.ts
 * son la red de seguridad de comportamiento y no se tocan (salvo el reordenar
 * de su setup, acordado aparte).
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { LISTINGS_INDEX } from 'src/modules/search/search.service';

const BOOL_CATEGORY_SLUG = 'search-dyn-bool-test';

describe('Search — atributos filtrables dinámicos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();

    // Ningún atributo boolean existe en el fixture global de test
    // (prisma/seed-test.ts); se crea aquí, ANTES de app.init(), para que
    // FilterableAttributesResolver lo vea en su resolución de arranque.
    await prisma.category.deleteMany({ where: { slug: BOOL_CATEGORY_SLUG } });
    await prisma.category.create({
      data: {
        name: 'Search Dyn Bool Test',
        slug: BOOL_CATEGORY_SLUG,
        order: 999,
        attributeSchema: [
          { name: 'testBoolAttr', label: 'Test Bool', type: 'boolean', filterable: true, required: false },
        ],
      },
    });

    app = await createTestApp();
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('GET /api/search?atributoInventado=x → 400 (clave que no es campo core ni atributo filtrable conocido)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search?atributoInventado=x')
      .expect(400);

    expect(res.body.statusCode).toBe(400);
  });

  it('GET /api/search?brand=Seat → 200 (atributo filtrable derivado del esquema de categorías, no de una lista hardcodeada)', async () => {
    await request(app.getHttpServer())
      .get('/api/search?brand=Seat')
      .expect(200);
  });

  it('GET /api/search?year=noEsUnNumero → 400 (atributo type:number con valor no numérico)', async () => {
    await request(app.getHttpServer())
      .get('/api/search?year=noEsUnNumero')
      .expect(400);
  });

  it('GET /api/search?testBoolAttr=cualquiercosa → 200 (atributo type:boolean coacciona a false sin rechazar, igual que el decorador anterior)', async () => {
    await request(app.getHttpServer())
      .get('/api/search?testBoolAttr=cualquiercosa')
      .expect(200);
  });

  it('GET /api/search?category=moviles&minPrice=10 → 200 (campos core sin cambios de validación)', async () => {
    await request(app.getHttpServer())
      .get('/api/search?category=moviles&minPrice=10')
      .expect(200);
  });

  it('GET /api/search?minPrice=abc → 400 (validación de campo core intacta)', async () => {
    await request(app.getHttpServer())
      .get('/api/search?minPrice=abc')
      .expect(400);
  });

  it('GET /api/search (sin params) → 200 (caso base, ambos flujos vacíos)', async () => {
    const res = await request(app.getHttpServer()).get('/api/search').expect(200);
    expect(res.body.hits).toBeInstanceOf(Array);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LA BARRERA DEL FLAKE — «los ajustes están APLICADOS cuando el método vuelve»
// ─────────────────────────────────────────────────────────────────────────────
//
// EL FALLO QUE CIERRA. `applyFilterableAttributes` hacía `await updateSettings(...)` y
// seguía. Pero `updateSettings` NO aplica nada: ENCOLA una tarea y devuelve su `taskUid`,
// así que ese `await` sólo esperaba a que Meilisearch aceptara el encargo. Entre ahí y que
// lo cumpliera había una ventana en la que el índice aún no conocía los
// `filterableAttributes` recién calculados, y una búsqueda que faceteara por uno de ellos
// respondía `Invalid facet distribution, attribute X is not filterable` → 500.
//
// En local Meili está ocioso y gana la carrera; en un runner cargado la pierde. Este
// fichero puso `main` en rojo por eso, y la prueba de que era eso es que los dos errores
// de aquella ejecución listaban conjuntos DISTINTOS de atributos filtrables: Meili estaba
// a media actualización.
//
// SE PRUEBA EL MECANISMO, NO LA AUSENCIA DEL SÍNTOMA. Repetir las búsquedas de arriba
// esperando que no fallen no vale: pasaban ya casi siempre. Lo que se afirma aquí es el
// CONTRATO — cuando `refreshFilterableAttributes()` resuelve, los ajustes están aplicados
// y el atributo nuevo es faceteable INMEDIATAMENTE, sin margen ni reintentos.
describe('Search — los ajustes del índice están aplicados al volver (arreglo del flake)', () => {
  const SLUG = 'search-dyn-flake-test';
  let app2: INestApplication;
  let prisma2: PrismaClient;

  beforeAll(async () => {
    prisma2 = new PrismaClient();
    await prisma2.category.deleteMany({ where: { slug: SLUG } });
    app2 = await createTestApp();
    await app2.init();
  }, 30_000);

  afterAll(async () => {
    await prisma2.category.deleteMany({ where: { slug: SLUG } });
    await app2.close();
    await prisma2.$disconnect();
  });

  it('un atributo filtrable NUEVO es faceteable en cuanto el refresco resuelve', async () => {
    // La categoría se crea DESPUÉS de arrancar, así que su atributo no estaba en el mapa
    // que se resolvió al inicio: es exactamente el caso del refresco en caliente.
    await prisma2.category.create({
      data: {
        name: 'Search Dyn Flake Test',
        slug: SLUG,
        order: 998,
        attributeSchema: [
          {
            name: 'flakeTestAttr', label: 'Flake', type: 'text',
            filterable: true, required: false,
          },
        ],
      },
    });

    const { SearchService } = await import('../src/modules/search/search.service');
    const { MeilisearchService } = await import(
      '../src/infra/meilisearch/meilisearch.service'
    );
    const search = app2.get(SearchService);

    // ── SE LE PONE COLA A MEILI A PROPÓSITO ──────────────────────────────────
    // Sin esto el test no vale para nada, y se comprobó: con Meilisearch ocioso aplica
    // los ajustes más rápido de lo que tarda el siguiente viaje HTTP, así que la versión
    // SIN `waitForTask` pasaba igual — cinco de cinco. La carrera sólo se ve cuando la
    // tarea de ajustes tiene que ponerse detrás de otra, que es exactamente lo que pasa en
    // un runner cargado y lo que puso `main` en rojo.
    //
    // Se encolan documentos SIN esperarlos: eso deja trabajo por delante en la cola de
    // Meili, y la tarea de `updateSettings` no se procesa hasta que le toca.
    const indice = app2.get(MeilisearchService).client.index(LISTINGS_INDEX);
    const lastre = Array.from({ length: 2_000 }, (_, i) => ({
      id: `flake-lastre-${i}`,
      title: `Lastre ${i}`,
      description: 'documento de relleno para dar cola a Meilisearch',
      price: i,
    }));
    await indice.addDocuments(lastre);

    await search.refreshFilterableAttributes();

    // SIN margen, SIN reintentos y SIN `waitFor`: si el refresco volviera antes de que
    // Meili hubiera aplicado los ajustes, esta llamada respondería 500 «attribute is not
    // filterable». Es la línea que el arreglo sostiene.
    await request(app2.getHttpServer()).get('/api/search?flakeTestAttr=x').expect(200);

    await indice.deleteDocuments(lastre.map((d) => d.id));
  });
});
