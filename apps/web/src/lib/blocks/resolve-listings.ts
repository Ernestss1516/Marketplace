import { search, type SearchResponse } from '@/lib/api/busqueda';
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
  // 'featured' -> sortDate:desc (max(publishedAt,bumpedAt)) favorece
  // reimpulsados. boostScore:desc sigue siendo la rankingRule que manda
  // primero en ambos casos (RF.8) — el badge "Destacado" no depende de esto.
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
export async function resolveListingsBlocksData(
  blocks: Block[],
): Promise<Record<string, SearchResponse>> {
  const listingsBlocks = blocks.filter(isListingsBlock);
  if (listingsBlocks.length === 0) return {};

  const entries = await Promise.all(
    listingsBlocks.map(async (block) => {
      const result = await search(
        { category: block.categorySlug, hitsPerPage: block.limit, sort: mapSort(block.sort) },
        { next: { revalidate: LISTINGS_BLOCK_REVALIDATE_SECONDS } },
      );
      return [block.id, result] as const;
    }),
  );

  return Object.fromEntries(entries);
}
