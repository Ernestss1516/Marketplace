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
  // 'recent' (o sin especificar) -> cronológico, igual que la portada escrita a mano.
  // 'featured' -> sortDate:desc, o sea `max(publishedAt, bumpedAt)`: los recién publicados y
  // los recién reimpulsados.
  //
  // ESTE ORDEN NO PRIVILEGIA A LOS DESTACADOS, Y AQUÍ SE AFIRMABA LO CONTRARIO. El comentario
  // que vivía en estas líneas decía que `boostScore:desc` seguía siendo la primera ranking
  // rule de Meilisearch — y cuando se escribió era verdad, así que la opción hacía lo que su
  // nombre prometía. La Política de ordenación C (RÁFAGA 1) sacó `boostScore` de
  // `rankingRules` para que el pago dejara de particionar las listas, actualizó `/busqueda` y
  // `/[categoria]`... y no pasó por aquí. El comentario se quedó afirmando en presente algo
  // que había dejado de ser cierto, y la opción, con un nombre que ya no cumplía.
  //
  // Por eso la etiqueta que ve el admin es ahora «Recientes o reimpulsados», que es lo que
  // esto hace. El VALOR sigue siendo 'featured' a propósito: está persistido en el JSON de
  // los bloques ya publicados y renombrarlo obligaría a migrar contenido para no ganar nada.
  // Ver docs/diseno-rotacion-destacados.md §10.2.
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
