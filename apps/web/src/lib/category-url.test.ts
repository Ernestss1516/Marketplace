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

describe('findCategoryUrlParts', () => {
  it('resuelve una raíz como sin padre', () => {
    expect(findCategoryUrlParts(tree, 'vehiculos')).toEqual({ slug: 'vehiculos', parentSlug: null });
  });

  it('resuelve una hija con su padre', () => {
    expect(findCategoryUrlParts(tree, 'coches')).toEqual({ slug: 'coches', parentSlug: 'vehiculos' });
    expect(findCategoryUrlParts(tree, 'pisos')).toEqual({ slug: 'pisos', parentSlug: 'inmuebles' });
  });

  it('tolera una raíz sin `children`', () => {
    expect(findCategoryUrlParts(tree, 'sin-hijas')).toEqual({ slug: 'sin-hijas', parentSlug: null });
  });

  it('devuelve null para un slug que no está en el árbol', () => {
    expect(findCategoryUrlParts(tree, 'no-existe')).toBeNull();
  });

  it('el resultado es directamente consumible por categoryPath', () => {
    const parts = findCategoryUrlParts(tree, 'motos')!;
    expect(categoryPath(parts)).toBe('/vehiculos/motos');
  });
});
