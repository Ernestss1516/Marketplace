import { categoryPath, categoryPathWithQuery, findCategoryUrlParts } from './category-url';

const tree = [
  { slug: 'vehiculos', children: [{ slug: 'coches' }, { slug: 'motos' }] },
  { slug: 'inmuebles', children: [{ slug: 'pisos' }] },
  { slug: 'sin-hijas' },
];

describe('categoryPath', () => {
  it('una raíz mantiene su URL plana — /vehiculos NO cambia con las rutas anidadas', () => {
    expect(categoryPath({ slug: 'vehiculos' })).toBe('/vehiculos');
    expect(categoryPath({ slug: 'vehiculos', parentSlug: null })).toBe('/vehiculos');
  });

  it('una hija cuelga de su padre', () => {
    expect(categoryPath({ slug: 'coches', parentSlug: 'vehiculos' })).toBe('/vehiculos/coches');
  });

  it('parentSlug ausente se degrada a URL plana (el catch-all la redirige), nunca a 404', () => {
    // Caso real: fichas servidas desde la caché Redis anterior al despliegue, cuyo
    // payload no lleva category.parent.
    expect(categoryPath({ slug: 'coches' })).toBe('/coches');
  });
});

describe('categoryPathWithQuery', () => {
  it('cuelga la query de la URL canónica', () => {
    const params = new URLSearchParams({ type: 'PRODUCT', minPrice: '1000' });
    expect(categoryPathWithQuery({ slug: 'coches', parentSlug: 'vehiculos' }, params))
      .toBe('/vehiculos/coches?type=PRODUCT&minPrice=1000');
  });

  it('sin parámetros no deja un "?" colgando — una URL con ? es otra URL para un crawler', () => {
    expect(categoryPathWithQuery({ slug: 'coches', parentSlug: 'vehiculos' }, new URLSearchParams()))
      .toBe('/vehiculos/coches');
  });
});

/**
 * PROFUNDIDAD N — RÁFAGA 3: FORMA ACTUALIZADA, misma intención.
 *
 * `findCategoryUrlParts` devolvía `parentSlug` (un solo nivel, que era todo lo
 * que podía haber). Ahora devuelve `ancestorSlugs`, la CADENA — es lo único que
 * permite construir la URL de una categoría de nivel 3 o 4. Lo que estos casos
 * verifican (que resuelve raíces, hijas y slugs desconocidos, y que el resultado
 * lo consume `categoryPath`) no cambia.
 */
describe('findCategoryUrlParts', () => {
  it('resuelve una raíz como sin ancestros', () => {
    expect(findCategoryUrlParts(tree, 'vehiculos')).toEqual({
      slug: 'vehiculos',
      ancestorSlugs: [],
    });
  });

  it('resuelve una hija con su cadena de ancestros', () => {
    expect(findCategoryUrlParts(tree, 'coches')).toEqual({
      slug: 'coches',
      ancestorSlugs: ['vehiculos'],
    });
    expect(findCategoryUrlParts(tree, 'pisos')).toEqual({
      slug: 'pisos',
      ancestorSlugs: ['inmuebles'],
    });
  });

  it('tolera una raíz sin `children`', () => {
    expect(findCategoryUrlParts(tree, 'sin-hijas')).toEqual({
      slug: 'sin-hijas',
      ancestorSlugs: [],
    });
  });

  it('devuelve null para un slug que no está en el árbol', () => {
    expect(findCategoryUrlParts(tree, 'no-existe')).toBeNull();
  });

  it('el resultado es directamente consumible por categoryPath', () => {
    const parts = findCategoryUrlParts(tree, 'motos')!;
    expect(categoryPath(parts)).toBe('/vehiculos/motos');
  });

  // Lo que sólo se puede comprobar con más de 2 niveles.
  it('resuelve una categoría de nivel 4 con sus tres ancestros', () => {
    const hondo = [
      {
        slug: 'vehiculos',
        children: [
          { slug: 'coches', children: [{ slug: 'deportivos', children: [{ slug: 'clasicos' }] }] },
        ],
      },
    ];
    expect(findCategoryUrlParts(hondo, 'clasicos')).toEqual({
      slug: 'clasicos',
      ancestorSlugs: ['vehiculos', 'coches', 'deportivos'],
    });
    expect(categoryPath(findCategoryUrlParts(hondo, 'clasicos')!)).toBe(
      '/vehiculos/coches/deportivos/clasicos',
    );
  });

  it('la forma ANTERIOR (`parentSlug`) sigue produciendo la misma URL', () => {
    // Lo que garantiza que un payload cacheado sin `ancestorSlugs` no rompa.
    expect(categoryPath({ slug: 'coches', parentSlug: 'vehiculos' })).toBe('/vehiculos/coches');
    expect(categoryPath({ slug: 'vehiculos', parentSlug: null })).toBe('/vehiculos');
  });
});
