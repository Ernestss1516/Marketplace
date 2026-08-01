/**
 * BÚSQUEDA+TAGS — RÁFAGA A2 (unificación de /busqueda y /[categoria]).
 *
 * Dos campos ADITIVOS en el árbol de `GET /categories`, ambos al servicio de una sola
 * decisión del frontend: qué filtros sobreviven al cambiar de categoría.
 *
 *   1. `allAttributes[].filterable` — desde RÁFAGA 1 el backend RECHAZA con 400 todo
 *      query param que no sea filtrable EN LA CATEGORÍA PEDIDA (defensa anti-leak
 *      cross-categoría). Sin este flag el cliente no puede saber qué arrastrar y
 *      arrastrarlo mal rompe la página con un 400.
 *   2. `allowedListingType` EFECTIVO — para descartar `condition` al saltar a una
 *      categoría solo-servicio (un servicio no tiene estado de conservación).
 *
 * El 400 del backend NO se toca: A2 filtra en cliente para no llegar a provocarlo.
 * Este spec verifica que el árbol trae lo necesario para poder hacerlo.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

interface TreeAttr {
  key: string;
  label: string;
  filterable: boolean;
}
interface TreeNode {
  slug: string;
  allowedListingType: string;
  allAttributes: TreeAttr[];
  children?: TreeNode[];
}

describe('GET /categories — metadatos de filtrado del árbol (A2, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tree: TreeNode[];

  let parentSlug: string;
  let childSlug: string;
  let serviceSlug: string;

  beforeAll(async () => {
    prisma = new PrismaClient();

    // Categorías creadas ANTES de createTestApp(): FilterableAttributesResolver
    // memoiza su mapa al arrancar (solo lo invalida el job
    // 'refresh-filterable-attributes' que encola el admin al editar por API). Sin
    // esto, estas categorías no existirían para el validador de query params y los
    // 400 de abajo saltarían por "categoría desconocida" en vez de por lo que se
    // quiere probar — pasarían por el motivo equivocado. Mismo patrón que
    // search-card-attributes-not-filterable.e2e-spec.ts.
    const stamp = `${Date.now()}`;
    parentSlug = `ctf-padre-${stamp}`;
    childSlug = `ctf-hija-${stamp}`;
    serviceSlug = `ctf-servicios-${stamp}`;

    const parent = await prisma.category.create({
      data: {
        name: 'CTF Padre', slug: parentSlug,
        attributeSchema: [
          { name: 'ctfYear', label: 'Año', type: 'number', filterable: true, required: false },
        ],
      },
    });
    await prisma.category.create({
      data: {
        name: 'CTF Hija', slug: childSlug, parentId: parent.id,
        attributeSchema: [
          { name: 'ctfFuel', label: 'Combustible', type: 'select', filterable: true, required: false, options: ['Diésel'] },
          // NO filtrable: mandarlo como query param también daría 400, así que el
          // cliente tiene que poder distinguirlo de los que sí valen.
          { name: 'ctfVin', label: 'Bastidor', type: 'text', filterable: false, required: false },
        ],
      },
    });
    // Categoría solo-servicio, para el descarte de `condition`.
    await prisma.category.create({
      data: { name: 'CTF Servicios', slug: serviceSlug, attributeSchema: [], allowedListingType: 'SERVICE_ONLY' },
    });

    app = await createTestApp();
    await app.init();

    const res = await request(app.getHttpServer()).get('/api/categories').expect(200);
    tree = res.body as TreeNode[];
  }, 30_000);

  afterAll(async () => {
    await prisma.category.deleteMany({ where: { slug: childSlug } });
    await prisma.category.deleteMany({ where: { slug: { in: [parentSlug, serviceSlug] } } });
    await app.close();
    await prisma.$disconnect();
  });

  const find = (slug: string): TreeNode => {
    for (const root of tree) {
      if (root.slug === slug) return root;
      const child = (root.children ?? []).find((c) => c.slug === slug);
      if (child) return child;
    }
    throw new Error(`categoría ${slug} no encontrada en el árbol`);
  };

  // ── 1. filterable ───────────────────────────────────────────────────────────

  it('cada entrada de allAttributes dice si es filtrable', () => {
    const hija = find(childSlug);
    const fuel = hija.allAttributes.find((a) => a.key === 'ctfFuel');
    const vin = hija.allAttributes.find((a) => a.key === 'ctfVin');

    expect(fuel?.filterable).toBe(true);
    expect(vin?.filterable).toBe(false);
  });

  it('la hija trae también los atributos HEREDADOS con su filterable', () => {
    // La herencia ya la resuelve el backend, así que el cliente no la recalcula.
    const heredado = find(childSlug).allAttributes.find((a) => a.key === 'ctfYear');
    expect(heredado).toBeDefined();
    expect(heredado!.filterable).toBe(true);
  });

  it('el padre trae los suyos (la unión con las hijas la hace el cliente)', () => {
    const padre = find(parentSlug);
    expect(padre.allAttributes.map((a) => a.key)).toContain('ctfYear');
  });

  it('sigue trayendo label/unit y lo demás — el campo es aditivo, no sustituye nada', () => {
    const fuel = find(childSlug).allAttributes.find((a) => a.key === 'ctfFuel');
    expect(fuel).toMatchObject({ key: 'ctfFuel', label: 'Combustible', filterable: true });
    expect(fuel).toHaveProperty('showLabel');
    expect(fuel).toHaveProperty('showUnit');
  });

  // ── 2. allowedListingType efectivo ──────────────────────────────────────────

  it('cada nodo trae su política EFECTIVA de tipo de anuncio', () => {
    expect(find(serviceSlug).allowedListingType).toBe('SERVICE_ONLY');
    expect(find(parentSlug).allowedListingType).toBe('BOTH');
  });

  it('la hija hereda la política del padre cuando no define la suya', () => {
    // El padre es BOTH y la hija no configura nada → efectiva BOTH.
    expect(find(childSlug).allowedListingType).toBe('BOTH');
  });

  it('una hija de un padre solo-servicio hereda SERVICE_ONLY', async () => {
    const padreServicio = await prisma.category.findUniqueOrThrow({ where: { slug: serviceSlug } });
    const hijaSlug = `ctf-hija-serv-${Date.now()}`;
    await prisma.category.create({
      data: { name: 'CTF Hija Serv', slug: hijaSlug, parentId: padreServicio.id, attributeSchema: [] },
    });

    // El árbol se lee de la BD en cada petición (no memoiza), así que una categoría
    // creada ahora sí aparece — a diferencia del mapa de atributos filtrables.
    const res = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const refreshed = res.body as TreeNode[];
    const hija = refreshed
      .flatMap((r) => r.children ?? [])
      .find((c) => c.slug === hijaSlug);

    expect(hija?.allowedListingType).toBe('SERVICE_ONLY');

    await prisma.category.deleteMany({ where: { slug: hijaSlug } });
  });

  // ── 3. El 400 anti-leak sigue intacto ───────────────────────────────────────

  it('el backend SIGUE rechazando un atributo ajeno a la categoría (defensa no relajada)', async () => {
    // A2 filtra en cliente para no llegar aquí, pero la defensa tiene que seguir.
    const res = await request(app.getHttpServer())
      .get(`/api/search?category=${childSlug}&ctfRooms=3`)
      .expect(400);

    expect(JSON.stringify(res.body)).toMatch(/ctfRooms/);
  });

  it('y también un atributo que existe pero NO es filtrable', async () => {
    // La razón de que `filterable` tenga que viajar: `ctfVin` está en allAttributes,
    // pero mandarlo como filtro es un 400 igual que uno inventado.
    await request(app.getHttpServer())
      .get(`/api/search?category=${childSlug}&ctfVin=XYZ`)
      .expect(400);
  });

  it('un atributo filtrable de la categoría SÍ se acepta (el contraste)', async () => {
    await request(app.getHttpServer())
      .get(`/api/search?category=${childSlug}&ctfFuel=Di%C3%A9sel`)
      .expect(200);
  });
});
