// SISTEMA DE BLOQUES — Ráfaga 3. Resolución SSR del bloque `listings`: mapeo
// sort recent/featured -> search(), TTL corto pasado como next.revalidate
// (la decisión de caché de esta ráfaga — ver estado-tecnico.md), y
// Promise.all para varios bloques a la vez.

import { resolveListingsBlocksData, LISTINGS_BLOCK_REVALIDATE_SECONDS } from './resolve-listings';
import { search } from '@/lib/api/busqueda';
import { getCategories } from '@/lib/api/categorias';
import type { Block } from '@/types/blocks';

jest.mock('@/lib/api/busqueda', () => ({
  search: jest.fn(),
}));

// A1 — el resolver devuelve además el árbol de categorías, que el bloque necesita
// para la URL canónica de su "Ver todos" (/vehiculos/coches).
jest.mock('@/lib/api/categorias', () => ({
  getCategories: jest.fn(),
}));

const mockedSearch = search as jest.Mock;
const mockedGetCategories = getCategories as jest.Mock;

describe('resolveListingsBlocksData', () => {
  beforeEach(() => {
    mockedSearch.mockReset();
    mockedGetCategories.mockReset();
    mockedGetCategories.mockResolvedValue([]);
  });

  it('sin bloques `listings` → no llama a search(), devuelve {}', async () => {
    const blocks: Block[] = [{ id: 'b1', type: 'separator' }];
    const result = await resolveListingsBlocksData(blocks);
    expect(result.data).toEqual({});
    expect(mockedSearch).not.toHaveBeenCalled();
    // A1 — el árbol tampoco se pide: una página sin bloques de anuncios no paga
    // la consulta añadida por las URLs anidadas.
    expect(mockedGetCategories).not.toHaveBeenCalled();
  });

  it('un bloque `listings` sin sort (o "recent") → sort:publishedAt:desc, con el TTL corto propio', async () => {
    mockedSearch.mockResolvedValue({ hits: [], totalHits: 0, page: 1, hitsPerPage: 8 });
    const blocks: Block[] = [{ id: 'b1', type: 'listings', categorySlug: 'electronica', limit: 8 }];

    await resolveListingsBlocksData(blocks);

    expect(mockedSearch).toHaveBeenCalledWith(
      { category: 'electronica', hitsPerPage: 8, sort: 'publishedAt:desc' },
      { next: { revalidate: LISTINGS_BLOCK_REVALIDATE_SECONDS } },
    );
  });

  it('sort "featured" → sort:sortDate:desc (favorece re-impulsados, boostScore sigue mandando primero en Meili)', async () => {
    mockedSearch.mockResolvedValue({ hits: [], totalHits: 0, page: 1, hitsPerPage: 4 });
    const blocks: Block[] = [
      { id: 'b1', type: 'listings', categorySlug: 'coches', limit: 4, sort: 'featured' },
    ];

    await resolveListingsBlocksData(blocks);

    expect(mockedSearch).toHaveBeenCalledWith(
      { category: 'coches', hitsPerPage: 4, sort: 'sortDate:desc' },
      { next: { revalidate: LISTINGS_BLOCK_REVALIDATE_SECONDS } },
    );
  });

  it('varios bloques `listings` se resuelven en paralelo, uno por id', async () => {
    mockedSearch
      .mockResolvedValueOnce({ hits: [{ id: 'l1' }], totalHits: 1, page: 1, hitsPerPage: 4 })
      .mockResolvedValueOnce({ hits: [], totalHits: 0, page: 1, hitsPerPage: 4 });
    const blocks: Block[] = [
      { id: 'b1', type: 'listings', categorySlug: 'electronica', limit: 4 },
      { id: 'b2', type: 'listings', categorySlug: 'vehiculos', limit: 4 },
    ];

    const result = await resolveListingsBlocksData(blocks);

    expect(mockedSearch).toHaveBeenCalledTimes(2);
    expect(result.data.b1.totalHits).toBe(1);
    expect(result.data.b2.totalHits).toBe(0);
  });

  it('bloques que no son `listings` se ignoran, no afectan la clave del resultado', async () => {
    mockedSearch.mockResolvedValue({ hits: [], totalHits: 0, page: 1, hitsPerPage: 4 });
    const blocks: Block[] = [
      { id: 'b1', type: 'text', markdown: 'x' },
      { id: 'b2', type: 'listings', categorySlug: 'electronica', limit: 4 },
    ];

    const result = await resolveListingsBlocksData(blocks);

    expect(Object.keys(result.data)).toEqual(['b2']);
  });

  // ── A1 — árbol de categorías para la URL canónica del "Ver todos" ──────────
  it('con un bloque `listings` devuelve el árbol de categorías junto a los datos', async () => {
    mockedSearch.mockResolvedValue({ hits: [], totalHits: 0, page: 1, hitsPerPage: 4 });
    const tree = [{ id: 'c1', name: 'Vehículos', slug: 'vehiculos', children: [] }];
    mockedGetCategories.mockResolvedValue(tree);
    const blocks: Block[] = [{ id: 'b1', type: 'listings', categorySlug: 'vehiculos', limit: 4 }];

    const result = await resolveListingsBlocksData(blocks);

    expect(result.categories).toEqual(tree);
  });

  it('si el árbol falla, los datos del bloque siguen llegando (el enlace cae a la URL plana, que redirige)', async () => {
    mockedSearch.mockResolvedValue({ hits: [], totalHits: 0, page: 1, hitsPerPage: 4 });
    mockedGetCategories.mockRejectedValue(new Error('API caída'));
    const blocks: Block[] = [{ id: 'b1', type: 'listings', categorySlug: 'vehiculos', limit: 4 }];

    const result = await resolveListingsBlocksData(blocks);

    expect(result.categories).toEqual([]);
    expect(result.data.b1).toBeDefined();
  });
});
