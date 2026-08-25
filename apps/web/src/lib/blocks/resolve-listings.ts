import { search, type SearchResponse } from '@/lib/api/busqueda';
import { getCategories } from '@/lib/api/categorias';
import type { Category } from '@/types';
import type { Block, ListingsBlock, ListingsBlockSort } from '@/types/blocks';

// TTL corto y propio del bloque `listings` — decisión de Ráfaga 3 (ver
// estado-tecnico.md, "Sistema de bloques — Ráfaga 3: caché"). Al pasarse
// como next.revalidate en la llamada a search(), Next.js toma el MÍNIMO
// revalidate entre todos los fetch() de una página concreta como su
// intervalo ISR efectivo — así que solo las páginas que SÍ incluyen un
// bloque `listings` bajan su caché a este valor; el resto conserva intacto
// el revalidate=3600 de la ruta (/paginas/[slug], /blog/[slug]).
export const LISTINGS_BLOCK_REVALIDATE_SECONDS = 180;

function mapSort(sort: ListingsBlockSort | undefined): 'publishedAt:desc' | 'sortDate:desc' {
  // 'recent' (o sin especificar) -> cronológico, igual que la portada.
  // 'featured' -> sortDate:desc, o sea `max(publishedAt, bumpedAt)`: los recién publicados y
  // los recién reimpulsados.
  //
  // ESTE ORDEN NO PRIVILEGIA A LOS DESTACADOS, Y AQUÍ SE AFIRMABA LO CONTRARIO (con un «(RF.8)»
  // que le daba autoridad). Era verdad cuando se escribió; la Política de ordenación C
  // (RÁFAGA 1) sacó `boostScore` de `rankingRules` y no pasó por este fichero, así que el
  // comentario se quedó afirmando en presente algo que había dejado de ser cierto — y la
  // opción, con un nombre que ya no cumplía.
  //
  // La etiqueta que ve el admin es ahora «Recientes o reimpulsados». El VALOR sigue siendo
  // 'featured' a propósito: está persistido en el JSON de los bloques ya publicados y
  // renombrarlo obligaría a migrar contenido para no ganar nada.
  // Ver docs/diseno-rotacion-destacados.md §10.2.
  return sort === 'featured' ? 'sortDate:desc' : 'publishedAt:desc';
}

function isListingsBlock(block: Block): block is ListingsBlock {
  return block.type === 'listings';
}

// Resuelve TODOS los bloques `listings` de una página en paralelo
// (Promise.all) — llamado por el server component de la página ANTES de
// pasar el resultado a <BlockRenderer listingsData={...} />. BlockRenderer
// en sí sigue siendo síncrono (lo comparte el preview client-side del
// editor, que resuelve sus propios datos de forma equivalente).
//
// A1 — devuelve además el ÁRBOL de categorías, que el bloque necesita para
// construir la URL canónica de su enlace "Ver todos" (/vehiculos/coches en vez de
// /busqueda?category=coches). Va aquí y no en cada página porque este es el único
// sitio que ya sabe si hay algún bloque `listings`: sin ninguno, sigue siendo un
// no-op instantáneo y las páginas sin bloques de anuncios no pagan la consulta.
// En paralelo con las búsquedas, no en serie. `categories: []` si falla — el
// enlace cae entonces a la URL plana (que redirige), nunca rompe la página.
export interface ListingsBlocksResolution {
  data: Record<string, SearchResponse>;
  categories: Category[];
}

export async function resolveListingsBlocksData(
  blocks: Block[],
): Promise<ListingsBlocksResolution> {
  const listingsBlocks = blocks.filter(isListingsBlock);
  if (listingsBlocks.length === 0) return { data: {}, categories: [] };

  const [entries, categories] = await Promise.all([
    Promise.all(
      listingsBlocks.map(async (block) => {
        const result = await search(
          { category: block.categorySlug, hitsPerPage: block.limit, sort: mapSort(block.sort) },
          { next: { revalidate: LISTINGS_BLOCK_REVALIDATE_SECONDS } },
        );
        return [block.id, result] as const;
      }),
    ),
    getCategories().catch(() => [] as Category[]),
  ]);

  return { data: Object.fromEntries(entries), categories };
}
