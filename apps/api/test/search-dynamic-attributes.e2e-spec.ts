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
