import Link from 'next/link';
import type { ListingsBlock } from '@/types/blocks';
import type { SearchResponse } from '@/lib/api/busqueda';
import type { Category, ListingSummary } from '@/types';
import { ListingCard } from '@/components/anuncios/ListingCard';
import { isSponsoredAdHit } from '@/components/anuncios/SponsoredCard';
import { categoryPath, findCategoryUrlParts } from '@/lib/category-url';

// Primer bloque DINÁMICO: no resuelve su propia consulta (rompería el
// contrato síncrono de BlockRenderer, compartido con el preview client-side
// del editor) — recibe `data` ya resuelto por el llamador. En el sitio
// público lo resuelve el server component de la página vía search() +
// Promise.all (ver /paginas/[slug] y /blog/[slug]); en el editor lo resuelve
// un efecto cliente equivalente. Misma fuente (search()) en ambos casos.
//
// Estado vacío: si `data` no llega o no tiene anuncios, el bloque se OCULTA
// (return null) — no deja un hueco visible en la página. El aviso al admin
// de "esta categoría no tiene anuncios" vive en el editor, no aquí.
//
// Patrocinados excluidos a propósito (isSponsoredAdHit filtrado): un bloque
// de contenido editorial no debe convertirse en un hueco de inventario
// publicitario sin que se haya pedido explícitamente.
//
// Sin FavoritesGridProvider/CardAttributesProvider: ListingCard degrada con
// gracia sin ellos (sin corazón de favorito, sin línea de atributo variable)
// — evita meter la resolución de atributos por categoría dentro del sistema
// de bloques. Decisión documentada en estado-tecnico.md.
//
// A1 (URLs anidadas) — "Ver todos" apunta ahora a la RUTA DE CATEGORÍA
// (/vehiculos/coches) en vez de a /busqueda?category=…: una sola URL por
// categoría, sin dos rutas compitiendo por el mismo contenido.
// `categories` (el árbol) es opcional porque el bloque también se renderiza en el
// preview del editor, que es síncrono y client-side: sin árbol se emite la URL
// plana, que el catch-all redirige. Las páginas públicas —las únicas que un
// crawler ve— SÍ lo pasan, así que ningún enlace indexable gasta un redirect.
export function ListingsBlockRenderer({
  block,
  data,
  categories,
}: {
  block: ListingsBlock;
  data?: SearchResponse;
  categories?: Category[];
}) {
  if (!data) return null;
  const listings = data.hits.filter((h): h is ListingSummary => !isSponsoredAdHit(h));
  if (listings.length === 0) return null;

  const urlParts =
    (categories && findCategoryUrlParts(categories, block.categorySlug)) ??
    { slug: block.categorySlug };

  return (
    <div>
      {block.title && <h2 className="mb-4 text-xl font-semibold">{block.title}</h2>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {listings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>
      {block.showAllLink && (
        <Link
          href={categoryPath(urlParts)}
          className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
        >
          Ver todos →
        </Link>
      )}
    </div>
  );
}
