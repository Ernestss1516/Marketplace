import Link from 'next/link';
import type { HomeCategoryCarouselBlock } from '@/types/home-blocks';
import type { Category } from '@/types';
import { categoryPath, findCategoryUrlParts } from '@/lib/category-url';
import { recorrerArbol } from '@/lib/category-tree';
import { isSafeSrc } from '@/lib/image-domains';
import { CarouselScroller } from './CarouselScroller';

/**
 * Carrusel de categorías. **Server Component**: las N categorías configuradas se
 * pintan AQUÍ y viajan enteras en el HTML servido. El island de al lado solo
 * desplaza (docs/diseno-portada.md §4.2).
 *
 * Base conceptual: `CategoryGrid`, que ya resolvía casi todo sin una línea de JS
 * (scroll horizontal CSS con `snap-x`). Lo que cambia es de dónde sale la
 * imagen: no de `Category.iconUrl` —un icono de 48 px guardado como texto libre
 * sin validar— sino del propio bloque, subida por el endpoint de portada y
 * restringida a nuestro almacenamiento.
 *
 * SLUG COLGADO: si alguien borra una categoría, su ítem se OMITE en vez de dejar
 * un enlace a un 404. Es la doctrina "se acepta al escribir, se oculta al leer"
 * que el nav ya adoptó, y aquí hace falta porque no hay FK que proteja ese
 * borrado — el bloque guarda un slug, no una referencia.
 */
export function CategoryCarouselHomeBlockRenderer({
  block,
  categories = [],
}: {
  block: HomeCategoryCarouselBlock;
  categories?: Category[];
}) {
  // Se resuelve contra el árbol que la página ya cargó: ni una consulta más.
  const items = block.items
    .map((item) => {
      const urlParts = findCategoryUrlParts(categories, item.categorySlug);
      if (!urlParts) return null; // slug colgado → fuera, sin romper la fila
      const categoria = categories
        .flatMap((c) => recorrerArbol([c]))
        .find((c) => c.slug === item.categorySlug);
      return {
        ...item,
        // Nunca se concatena `/${slug}`: la URL canónica la construye SIEMPRE
        // categoryPath (regla de proyecto, lib/category-url.ts:5-9).
        href: categoryPath(urlParts),
        texto: item.label ?? categoria?.name ?? item.categorySlug,
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null);

  if (items.length === 0) return null;

  return (
    <div>
      {block.title && <h2 className="mb-4 text-xl font-semibold">{block.title}</h2>}

      <CarouselScroller>
        {items.map((item) => (
          <Link
            key={item.categorySlug}
            href={item.href}
            /* ESCAPARATE C-bis — TARJETA ALTA, CON LA FOTO A SANGRE.
               Era una tarjeta ancha de 128 px con la foto acolchada dentro y recortada a
               80 px de alto. Ahora la foto llega a los bordes y manda la proporción
               (`aspect-[4/5]`), con el texto debajo en su propia franja.

               Todo son clases, ni un nodo nuevo: el `<a>` suelta su `p-3` y su `gap` y
               gana `overflow-hidden` —lo que hace que la foto respete la curva—, la
               imagen cambia de alto fijo a proporción fija, y el texto recupera el
               padding que antes ponía el padre.

               `aspect-[4/5]` literal, como el `aspect-[4/3]` de la rejilla: una
               proporción interpolada no existiría en el CSS final.

               ESCAPARATE C — el gesto compartido (`.tarjeta-levanta`, globals.css). */
            className="tarjeta-levanta flex w-36 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border bg-card text-center hover:border-primary/40"
          >
            {isSafeSrc(item.imageUrl) ? (
              // <img> plano y no next/image: el bloque no guarda dimensiones.
              // Mismo criterio que ImageBlockRenderer y que la rejilla de RP.4.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt={item.alt}
                className="aspect-[4/5] w-full object-cover"
              />
            ) : (
              // La imagen no pasa el guard de dominio (ver §7 del diseño: las dos
              // allowlists pueden desalinearse). Se degrada a la inicial en un
              // círculo —lo mismo que hace CategoryGrid sin iconUrl— en vez de
              // dejar un hueco: en una fila de tarjetas, un hueco rompe la
              // maquetación. Mismo criterio que la rejilla de RP.4.
              //
              // C-bis: la misma proporción que la foto, o una categoría sin imagen
              // rompería la altura de la fila entera.
              <div className="flex aspect-[4/5] w-full items-center justify-center bg-primary/10 text-3xl font-bold text-primary">
                {item.texto[0]}
              </div>
            )}
            <span className="px-3 py-3 text-xs font-medium leading-tight">{item.texto}</span>
          </Link>
        ))}
      </CarouselScroller>
    </div>
  );
}
