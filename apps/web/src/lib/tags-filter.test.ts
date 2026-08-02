/**
 * B3 — qué pasa con `?tags=` al cambiar de categoría, y qué etiquetas ofrece el panel.
 *
 * Las dos cosas son lógica pura sobre el árbol de categorías, así que se prueban aquí
 * en vez de a través de la UI: el cambio de categoría es un `router.push` y medirlo en
 * Playwright probaría la navegación, no la regla.
 */

import { carryFilters, effectiveTagSlugsFor } from './filter-carry';
import { availableTagsForCategory, availableTagsForTree } from './available-tags';
import type { Category } from '@/types';

const tag = (slug: string) => ({ id: `id-${slug}`, slug, name: slug.toUpperCase() });

/**
 * vehiculos (raíz) → garantia
 *   coches (hija)   → unico-dueno  [+ garantia heredado]
 * inmobiliaria (raíz) → sin tags
 *   pisos (hija)      → amueblado
 */
const TREE: Category[] = [
  {
    id: 'c1', name: 'Vehículos', slug: 'vehiculos',
    tags: [tag('garantia')],
    children: [
      {
        id: 'c2', name: 'Coches', slug: 'coches', parentSlug: 'vehiculos',
        // El backend ya resolvió la herencia: propios primero, luego los del padre.
        tags: [tag('unico-dueno'), tag('garantia')],
      },
    ],
  },
  {
    id: 'c3', name: 'Inmobiliaria', slug: 'inmobiliaria',
    tags: [],
    children: [
      { id: 'c4', name: 'Pisos', slug: 'pisos', parentSlug: 'inmobiliaria', tags: [tag('amueblado')] },
    ],
  },
];

describe('effectiveTagSlugsFor — qué etiquetas valen en el destino', () => {
  it('una HOJA ofrece las suyas y las heredadas', () => {
    expect(effectiveTagSlugsFor(TREE, 'coches')).toEqual(
      new Set(['unico-dueno', 'garantia']),
    );
  });

  it('una RAÍZ ofrece las suyas MÁS las de sus hijas', () => {
    // Navegar /vehiculos agrega los anuncios de coches, así que un tag de coches es un
    // filtro legítimo ahí — misma regla que los atributos.
    expect(effectiveTagSlugsFor(TREE, 'vehiculos')).toEqual(
      new Set(['garantia', 'unico-dueno']),
    );
  });

  it('destino "Todas" devuelve null — el vocabulario es global', () => {
    expect(effectiveTagSlugsFor(TREE, null)).toBeNull();
  });

  it('un slug desconocido no ofrece nada, en vez de ofrecerlo todo', () => {
    expect(effectiveTagSlugsFor(TREE, 'no-existe')).toEqual(new Set());
  });
});

describe('carryFilters — las etiquetas al cambiar de categoría', () => {
  const cambiar = (query: string, destino: string | null) =>
    carryFilters(
      new URLSearchParams(query),
      destino ? { slug: destino } : null,
      new Set<string>(),
      effectiveTagSlugsFor(TREE, destino),
    );

  it('un tag que SIGUE siendo válido en el destino se conserva', () => {
    // `garantia` se ofrece tanto en coches como en vehiculos.
    expect(cambiar('tags=garantia', 'vehiculos').get('tags')).toBe('garantia');
  });

  it('un tag que NO aplica en el destino se descarta', () => {
    expect(cambiar('tags=unico-dueno', 'pisos').get('tags')).toBeNull();
  });

  it('de varios, sobreviven SOLO los válidos — no se pierden todos ni se arrastra basura', () => {
    // Lo útil es llegar a /vehiculos filtrando por garantia, no perder los dos.
    const next = cambiar('tags=unico-dueno,amueblado,garantia', 'vehiculos');
    expect(next.get('tags')).toBe('unico-dueno,garantia');
  });

  it('a "Todas las categorías" sobreviven todos: el vocabulario es global', () => {
    expect(cambiar('tags=unico-dueno,amueblado', null).get('tags')).toBe(
      'unico-dueno,amueblado',
    );
  });

  it('sin ?tags= no se inventa el parámetro', () => {
    expect(cambiar('q=coche', 'coches').has('tags')).toBe(false);
  });

  it('el resto de filtros core siguen viajando igual', () => {
    // El requisito de oro: añadir el carry de tags no toca lo que ya funcionaba.
    const next = cambiar('q=coche&province=Madrid&minPrice=100&tags=garantia', 'vehiculos');
    expect(next.get('q')).toBe('coche');
    expect(next.get('province')).toBe('Madrid');
    expect(next.get('minPrice')).toBe('100');
  });
});

describe('availableTags — qué ofrece el panel', () => {
  it('una hoja ofrece sus efectivos, propios primero', () => {
    expect(availableTagsForCategory(TREE, 'coches').map((t) => t.slug)).toEqual([
      'unico-dueno', 'garantia',
    ]);
  });

  it('una raíz ofrece los suyos y los de sus hijas, sin repetir', () => {
    expect(availableTagsForCategory(TREE, 'vehiculos').map((t) => t.slug)).toEqual([
      'garantia', 'unico-dueno',
    ]);
  });

  it('el árbol entero es la unión, deduplicada por slug', () => {
    expect(availableTagsForTree(TREE).map((t) => t.slug)).toEqual([
      'garantia', 'unico-dueno', 'amueblado',
    ]);
  });

  it('una categoría sin etiquetas no ofrece ninguna (la sección no se pinta)', () => {
    expect(availableTagsForCategory(TREE, 'inmobiliaria').map((t) => t.slug)).toEqual([
      'amueblado',
    ]);
    // La raíz no tiene propias, pero hereda hacia arriba desde su hija al navegarla.
    expect(availableTagsForCategory(TREE, 'no-existe')).toEqual([]);
  });
});
