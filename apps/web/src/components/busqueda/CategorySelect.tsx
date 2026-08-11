'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { categoryPathWithQuery } from '@/lib/category-url';
import { carryFilters, effectiveTagSlugsFor, filterableAttributeNamesFor } from '@/lib/filter-carry';
import type { Category } from '@/types';

/**
 * A2 — selector de categoría ÚNICO, presente en las dos páginas de resultados.
 *
 * Sustituye a dos controles que hacían cosas distintas con el mismo nombre:
 *  - el "Categoría" de /busqueda, que solo cambiaba el query param `category` y te
 *    dejaba en /busqueda;
 *  - el "Subcategoría" de /[categoria], que sí navegaba, pero solo hacia abajo.
 *
 * Ahora cualquier destino del árbol (y "Todas las categorías") es alcanzable desde
 * cualquiera de las dos páginas, y siempre navegando a la ruta CANÓNICA:
 *
 *   /busqueda?q=x        + Coches  →  /vehiculos/coches?q=x
 *   /vehiculos/coches?q=x + Todas   →  /busqueda?q=x
 *   /vehiculos?…          + Coches  →  /vehiculos/coches?…
 *
 * Los filtros se arrastran, pero SOLO los que valen en el destino: ver lib/filter-carry.ts
 * (el backend responde 400 a un atributo ajeno, así que el filtrado ocurre antes de
 * navegar, no después de romperse).
 */
export function CategorySelect({
  categories,
  currentSlug,
}: {
  /** Árbol completo (`GET /categories`). */
  categories: Category[];
  /** Categoría en la que está el usuario ahora, o null en /busqueda global. */
  currentSlug: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function goTo(slug: string) {
    const target = slug === '' ? null : findTarget(categories, slug);
    const allowed = filterableAttributeNamesFor(categories, target?.slug ?? null);
    // B3 — los tags tienen su propia regla de validez en el destino (CategoryTag).
    const tagsPermitidos = effectiveTagSlugsFor(categories, target?.slug ?? null);
    const next = carryFilters(searchParams, target, allowed, tagsPermitidos);
    const query = next.toString();

    if (!target) {
      router.push(query ? `/busqueda?${query}` : '/busqueda');
      return;
    }
    router.push(categoryPathWithQuery(target, next));
  }

  return (
    <select
      value={currentSlug ?? ''}
      onChange={(e) => goTo(e.target.value)}
      className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      aria-label="Categoría"
    >
      <option value="">Todas las categorías</option>
      {aplanar(categories).map(({ slug, etiqueta }) => (
        <option key={slug} value={slug}>
          {etiqueta}
        </option>
      ))}
    </select>
  );
}

/** Separador del path aplanado. Contenido de cara al usuario. */
const SEPARADOR = ' › ';

/**
 * PROFUNDIDAD N — RÁFAGA 2. Aplana el árbol a una lista de opciones con el PATH
 * completo como etiqueta: «Vehículos › Coches › Deportivos».
 *
 * POR QUÉ ASÍ Y NO CON `<optgroup>` ANIDADOS: el estándar HTML **no permite
 * anidar optgroup**, así que un `<select>` nativo expresa como mucho DOS niveles
 * de agrupación. No es una limitación del componente: con 4 niveles no hay
 * forma de representarlo agrupando.
 *
 * Y por qué path aplanado y no un navegador por niveles (como `StepCategoria`
 * del wizard, que sí lo es): son casos de uso distintos. Publicar es ELEGIR una
 * categoría explorando; filtrar aquí es SALTAR a una que ya conoces, y para eso
 * una lista plana —buscable con el teclado del navegador, con toda la
 * profundidad visible de un vistazo— gana a navegar tres niveles.
 *
 * El orden es el del árbol (cada rama entera antes de la siguiente), así que las
 * categorías de 2 niveles se siguen leyendo exactamente igual que antes.
 */
function aplanar(
  nodos: Category[],
  prefijo: string[] = [],
): Array<{ slug: string; etiqueta: string }> {
  return nodos.flatMap((cat) => {
    const ruta = [...prefijo, cat.name];
    return [
      { slug: cat.slug, etiqueta: ruta.join(SEPARADOR) },
      ...aplanar(cat.children ?? [], ruta),
    ];
  });
}

/** Localiza la categoría destino en el árbol y devuelve lo que necesita el carry:
 *  su slug, el del padre (para la URL canónica) y su política de tipo (para `condition`).
 *
 *  PROFUNDIDAD N — RÁFAGA 2: la búsqueda es recursiva. `parentSlug` sigue siendo
 *  el del padre INMEDIATO: es lo que `categoryPath()` consume hoy, y las URLs
 *  profundas son RÁFAGA 3. */
function findTarget(tree: Category[], slug: string) {
  const cadena = cadenaHasta(tree, slug);
  if (cadena.length === 0) {
    // Slug fuera del árbol: no debería pasar (las opciones salen del propio árbol).
    // Se navega igual, sin padre — el middleware canonicaliza si hace falta.
    return { slug, parentSlug: null, allowedListingType: undefined };
  }
  const destino = cadena[cadena.length - 1];
  return {
    slug: destino.slug,
    parentSlug: cadena.at(-2)?.slug ?? null,
    allowedListingType: destino.allowedListingType,
  };
}

/** Cadena raíz→categoría (incluida). `[]` si el slug no está en el árbol. */
function cadenaHasta(nodos: Category[], slug: string): Category[] {
  for (const cat of nodos) {
    if (cat.slug === slug) return [cat];
    const resto = cadenaHasta(cat.children ?? [], slug);
    if (resto.length > 0) return [cat, ...resto];
  }
  return [];
}
