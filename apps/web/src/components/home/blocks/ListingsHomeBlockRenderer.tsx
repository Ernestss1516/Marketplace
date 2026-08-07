import Link from 'next/link';
import type { HomeListingsBlock } from '@/types/home-blocks';
import type { SearchResponse } from '@/lib/api/busqueda';
import type { Category, ListingSummary } from '@/types';
import { ListingCard } from '@/components/anuncios/ListingCard';
import { FavoritesGridProvider } from '@/components/anuncios/FavoritesGridContext';
import { CardAttributesProvider, type CardAttributeMap } from '@/components/anuncios/CardAttributesContext';
import { isSponsoredAdHit } from '@/components/anuncios/SponsoredCard';
import { categoryPath, findCategoryUrlParts } from '@/lib/category-url';

/**
 * Bloque de anuncios de la portada. **Server Component**: recibe `data` YA
 * RESUELTA (ver lib/home-blocks/resolve-listings.ts), nunca consulta durante el
 * render — es lo que mantiene síncrono a `HomeBlockRenderer`.
 *
 * ── LO QUE ESTE BLOQUE HACE Y EL DEL BLOG NO ────────────────────────────────
 *
 * 1. **Envuelve las tarjetas en los DOS providers.** El bloque `listings` del
 *    blog renunció a ellos a propósito (ListingsBlockRenderer.tsx:24-27): sus
 *    tarjetas van sin corazón de favorito y sin la línea de atributos por
 *    categoría. En la portada eso sería una REGRESIÓN visible, porque la home
 *    escrita a mano sí los tenía — así que aquí se recuperan (decisión 8).
 *
 *    Y NO rompe el SSR: los dos providers son `'use client'`, pero reciben los
 *    `ListingCard` como `children` creados en este Server Component, así que las
 *    tarjetas se renderizan en servidor y su HTML viaja en la respuesta. El
 *    cliente solo monta el contexto alrededor.
 *
 * 2. **`categorySlug` es opcional.** Sin él, `resolve-listings` consulta sin
 *    filtrar y esto pinta los recientes de todo el sitio.
 *
 * Patrocinados excluidos, igual que en el blog: un bloque de portada no debe
 * convertirse en hueco de inventario publicitario sin pedirlo. Sin `category`
 * el backend no inyecta ninguno de todas formas, así que el filtro es sobre todo
 * una guarda de tipos — la misma que la portada ya tenía escrita a mano.
 */
export function ListingsHomeBlockRenderer({
  block,
  data,
  categories,
  cardAttributeMap,
}: {
  block: HomeListingsBlock;
  data?: SearchResponse;
  categories?: Category[];
  cardAttributeMap?: CardAttributeMap;
}) {
  if (!data) return null;
  const listings = data.hits.filter((h): h is ListingSummary => !isSponsoredAdHit(h));

  // Estado vacío: el bloque se OCULTA en vez de dejar un hueco con un título y
  // nada debajo. El aviso al admin de "esta categoría no tiene anuncios" vive en
  // el editor, no aquí.
  if (listings.length === 0) return null;

  // "Ver todos": con categoría, a su ruta canónica (nunca `/${slug}` a mano);
  // sin categoría, a la búsqueda ordenada por fecha — que es exactamente a donde
  // apuntaba el enlace escrito a mano de la portada.
  const urlParts = block.categorySlug
    ? findCategoryUrlParts(categories ?? [], block.categorySlug) ?? { slug: block.categorySlug }
    : null;
  const verTodosHref = urlParts ? categoryPath(urlParts) : '/busqueda?sort=publishedAt:desc';

  return (
    <div>
      {(block.title || block.showAllLink) && (
        <div className="mb-4 flex items-center justify-between">
          {block.title ? <h2 className="text-xl font-semibold">{block.title}</h2> : <span />}
          {block.showAllLink && (
            <Link href={verTodosHref} className="text-sm font-medium text-primary hover:underline">
              Ver todos
            </Link>
          )}
        </div>
      )}

      <CardAttributesProvider cardAttributeMap={cardAttributeMap ?? {}}>
        <FavoritesGridProvider listingIds={listings.map((l) => l.id)}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        </FavoritesGridProvider>
      </CardAttributesProvider>
    </div>
  );
}
