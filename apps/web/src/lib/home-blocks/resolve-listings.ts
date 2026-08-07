import { search, type SearchResponse } from '@/lib/api/busqueda';
import type { HomeBlock, HomeListingsBlock, ListingsSort } from '@/types/home-blocks';

/**
 * TTL corto y propio de los bloques de anuncios. La portada se renderiza de
 * forma DINÁMICA (el `auth()` del layout raíz), así que esto no es un ISR de
 * ruta: actúa sobre la caché de `fetch` de Next, de modo que varias visitas
 * seguidas no golpean Meilisearch una vez por cada una, pero la lista se
 * refresca sola en menos de tres minutos.
 */
export const LISTINGS_REVALIDATE_SECONDS = 180;

function mapSort(sort: ListingsSort | undefined): 'publishedAt:desc' | 'sortDate:desc' {
  // 'recent' (o sin especificar) -> cronológico, igual que la portada escrita a
  // mano. 'featured' -> sortDate:desc (max(publishedAt, bumpedAt)), que favorece
  // los reimpulsados. boostScore:desc sigue siendo la primera rankingRule de
  // Meilisearch en ambos casos: el badge "Destacado" no depende de esto.
  return sort === 'featured' ? 'sortDate:desc' : 'publishedAt:desc';
}

function isListingsBlock(block: HomeBlock): block is HomeListingsBlock {
  return block.type === 'listings';
}

/**
 * Resuelve TODOS los bloques `listings` de la portada EN PARALELO y ANTES del
 * render. Es lo que permite que `HomeBlockRenderer` siga siendo SÍNCRONO —y por
 * tanto compartible con el preview client-side del editor— y lo que evita el
 * waterfall que habría si cada bloque pidiera lo suyo durante el render.
 *
 * FICHERO PROPIO, no el `lib/blocks/resolve-listings.ts` del blog: la firma de
 * aquel es `(blocks: Block[])`, y un tipo de bloque en la firma es exactamente
 * lo que la regla de §4.0 prohíbe cruzar entre motores. Son veinte líneas de
 * `Promise.all`; duplicarlas cuesta mucho menos que acoplar los dos sistemas de
 * tipos.
 *
 * Diferencia real con el del blog, no solo de tipos: aquí `categorySlug` puede
 * faltar, y entonces se consulta SIN filtro de categoría — los recientes de todo
 * el sitio.
 */
export async function resolveHomeListingsData(
  blocks: HomeBlock[],
): Promise<Record<string, SearchResponse>> {
  const listingsBlocks = blocks.filter(isListingsBlock);
  if (listingsBlocks.length === 0) return {};

  const entries = await Promise.all(
    listingsBlocks.map(async (block) => {
      const result = await search(
        {
          // `category` solo viaja si el bloque lo fija. Sin él, search() no
          // filtra por categoría y devuelve lo más reciente del sitio entero.
          ...(block.categorySlug ? { category: block.categorySlug } : {}),
          hitsPerPage: block.limit,
          sort: mapSort(block.sort),
        },
        { next: { revalidate: LISTINGS_REVALIDATE_SECONDS } },
      );
      return [block.id, result] as const;
    }),
  );

  return Object.fromEntries(entries);
}
