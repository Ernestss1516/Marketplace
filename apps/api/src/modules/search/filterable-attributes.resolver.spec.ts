import { Logger } from '@nestjs/common';
import { FilterableAttributesResolver } from './filterable-attributes.resolver';
import { CategoryTreeService } from '../categories/category-tree.service';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * PROFUNDIDAD N — RÁFAGA 1. Mantenimiento de FIXTURE por cambio de FIRMA:
 * el resolver ya no consulta Prisma, sino que pide la jerarquía a
 * `CategoryTreeService` (el único lector). Se le da un `CategoryTreeService`
 * REAL sobre el mismo Prisma mockeado, en vez de mockear el árbol: así estas
 * pruebas siguen ejerciendo la resolución de verdad —incluida la cadena— y no
 * un doble que podría diverger de ella. **Ninguna aserción cambia.**
 *
 * Las filas del mock pasan de `{ slug, parent: { slug } }` a `{ id, parentId }`
 * por el mismo motivo: es lo que selecciona el lector.
 */
function makeTree(rows: Array<Record<string, unknown>>) {
  const prisma = {
    category: { findMany: jest.fn().mockResolvedValue(rows) },
  } as unknown as PrismaService;
  return { tree: new CategoryTreeService(prisma), prisma };
}

function makeResolver(categories: Array<{ attributeSchema: unknown }>) {
  const { tree, prisma } = makeTree(
    categories.map((c, i) => ({
      id: `c${i}`,
      slug: `c${i}`,
      name: `c${i}`,
      parentId: null,
      allowedViews: [],
      defaultView: null,
      allowedPriceUnits: [],
      allowedListingType: 'BOTH',
      ...c,
    })),
  );
  return { resolver: new FilterableAttributesResolver(tree), prisma };
}

function makeResolverWithSlugs(
  categories: Array<{ slug: string; parent?: { slug: string } | null; attributeSchema: unknown }>,
) {
  const { tree, prisma } = makeTree(
    categories.map((c) => ({
      id: c.slug,
      slug: c.slug,
      name: c.slug,
      parentId: c.parent?.slug ?? null,
      allowedViews: [],
      defaultView: null,
      allowedPriceUnits: [],
      allowedListingType: 'BOTH',
      attributeSchema: c.attributeSchema,
    })),
  );
  return { resolver: new FilterableAttributesResolver(tree), prisma };
}

describe('FilterableAttributesResolver', () => {
  it('incluye los atributos filterable:true de todas las categorías (padres y hojas)', async () => {
    const { resolver } = makeResolver([
      { attributeSchema: [{ name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false }] },
      { attributeSchema: [{ name: 'year', label: 'Año', type: 'number', filterable: true, required: true }] },
    ]);

    const types = await resolver.getAttributeTypes();

    expect(types.get('brand')).toBe('text');
    expect(types.get('year')).toBe('number');
  });

  it('excluye atributos con filterable:false', async () => {
    const { resolver } = makeResolver([
      { attributeSchema: [{ name: 'model', label: 'Modelo', type: 'text', filterable: false, required: true }] },
    ]);

    const types = await resolver.getAttributeTypes();

    expect(types.has('model')).toBe(false);
  });

  it('excluye estructuralmente nombres reservados aunque una categoría los marque filterable:true', async () => {
    const { resolver } = makeResolver([
      { attributeSchema: [{ name: 'type', label: 'Tipo', type: 'text', filterable: true, required: false }] },
      { attributeSchema: [{ name: 'price', label: 'Precio', type: 'number', filterable: true, required: false }] },
    ]);

    const types = await resolver.getAttributeTypes();

    expect(types.has('type')).toBe(false);
    expect(types.has('price')).toBe(false);
  });

  it('ante conflicto de type entre categorías para el mismo name, conserva el primero y avisa (no rompe)', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { resolver } = makeResolver([
      { attributeSchema: [{ name: 'size', label: 'Talla', type: 'select', filterable: true, required: false }] },
      { attributeSchema: [{ name: 'size', label: 'Talla', type: 'number', filterable: true, required: false }] },
    ]);

    const types = await resolver.getAttributeTypes();

    expect(types.get('size')).toBe('select');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('tolera attributeSchema vacío o ausente', async () => {
    const { resolver } = makeResolver([
      { attributeSchema: [] },
      { attributeSchema: null },
    ]);

    const types = await resolver.getAttributeTypes();

    expect(types.size).toBe(0);
  });

  it('memoiza: una segunda llamada no vuelve a consultar Prisma', async () => {
    const { resolver, prisma } = makeResolver([]);

    await resolver.getAttributeTypes();
    await resolver.getAttributeTypes();

    expect(prisma.category.findMany).toHaveBeenCalledTimes(1);
  });

  describe('getAttributeTypesForCategory (RÁFAGA 1 — fix del leak cross-categoría)', () => {
    it('categoría hoja: incluye su propio schema + el heredado del padre, no el de otra rama', async () => {
      const { resolver } = makeResolverWithSlugs([
        {
          slug: 'vehiculos',
          parent: null,
          attributeSchema: [{ name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false }],
        },
        {
          slug: 'coches',
          parent: { slug: 'vehiculos' },
          attributeSchema: [{ name: 'fuel', label: 'Combustible', type: 'text', filterable: true, required: false }],
        },
        {
          slug: 'pisos',
          parent: null,
          attributeSchema: [{ name: 'rooms', label: 'Habitaciones', type: 'number', filterable: true, required: false }],
        },
      ]);

      const types = await resolver.getAttributeTypesForCategory('coches');

      expect(types.has('fuel')).toBe(true); // propio
      expect(types.has('brand')).toBe(true); // heredado del padre
      expect(types.has('rooms')).toBe(false); // de otra rama — el bug que se arregla
    });

    it('categoría padre: agrega su propio schema + el efectivo de cada hijo (browse mezcla hijos)', async () => {
      const { resolver } = makeResolverWithSlugs([
        {
          slug: 'vehiculos',
          parent: null,
          attributeSchema: [{ name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false }],
        },
        {
          slug: 'coches',
          parent: { slug: 'vehiculos' },
          attributeSchema: [{ name: 'fuel', label: 'Combustible', type: 'text', filterable: true, required: false }],
        },
        {
          slug: 'motos',
          parent: { slug: 'vehiculos' },
          attributeSchema: [{ name: 'displacement', label: 'Cilindrada', type: 'number', filterable: true, required: false }],
        },
      ]);

      const types = await resolver.getAttributeTypesForCategory('vehiculos');

      expect(types.has('brand')).toBe(true);
      expect(types.has('fuel')).toBe(true);
      expect(types.has('displacement')).toBe(true);
    });

    it('slug desconocido: mapa vacío (ningún atributo es válido para una categoría inexistente)', async () => {
      const { resolver } = makeResolverWithSlugs([
        { slug: 'coches', parent: null, attributeSchema: [] },
      ]);

      const types = await resolver.getAttributeTypesForCategory('no-existe');

      expect(types.size).toBe(0);
    });
  });

  describe('getAllAttributeNames(ForCategory) — ATRIBUTOS EN CARD (bug 1): sin filtrar por filterable', () => {
    it('getAllAttributeNames incluye atributos filterable:false (getAttributeTypes NO los incluiría)', async () => {
      const { resolver } = makeResolver([
        { attributeSchema: [{ name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false }] },
        { attributeSchema: [{ name: 'tariff', label: 'Tarifa', type: 'number', filterable: false, required: false }] },
      ]);

      const names = await resolver.getAllAttributeNames();

      expect(names.has('brand')).toBe(true);
      expect(names.has('tariff')).toBe(true); // el caso que getAttributeTypes() excluiría
    });

    it('getAllAttributeNamesForCategory: hoja incluye lo propio (filterable o no) + lo heredado del padre', async () => {
      const { resolver } = makeResolverWithSlugs([
        {
          slug: 'vehiculos', parent: null,
          attributeSchema: [{ name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false }],
        },
        {
          slug: 'coches', parent: { slug: 'vehiculos' },
          attributeSchema: [{ name: 'tariff', label: 'Tarifa', type: 'number', filterable: false, required: false }],
        },
        {
          slug: 'pisos', parent: null,
          attributeSchema: [{ name: 'rooms', label: 'Habitaciones', type: 'number', filterable: true, required: false }],
        },
      ]);

      const names = await resolver.getAllAttributeNamesForCategory('coches');

      expect(names.has('tariff')).toBe(true); // propio, no filtrable — el caso del bug 1
      expect(names.has('brand')).toBe(true); // heredado
      expect(names.has('rooms')).toBe(false); // otra rama
    });

    it('getAllAttributeNamesForCategory: padre agrega lo propio + lo de cada hijo (mismo criterio que getAttributeTypesForCategory)', async () => {
      const { resolver } = makeResolverWithSlugs([
        {
          slug: 'vehiculos', parent: null,
          attributeSchema: [{ name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false }],
        },
        {
          slug: 'coches', parent: { slug: 'vehiculos' },
          attributeSchema: [{ name: 'tariff', label: 'Tarifa', type: 'number', filterable: false, required: false }],
        },
      ]);

      const names = await resolver.getAllAttributeNamesForCategory('vehiculos');

      expect(names.has('brand')).toBe(true);
      expect(names.has('tariff')).toBe(true);
    });

    it('slug desconocido: set vacío', async () => {
      const { resolver } = makeResolverWithSlugs([
        { slug: 'coches', parent: null, attributeSchema: [] },
      ]);

      const names = await resolver.getAllAttributeNamesForCategory('no-existe');

      expect(names.size).toBe(0);
    });
  });
});
