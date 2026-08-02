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
      {categories.map((cat) =>
        cat.children && cat.children.length > 0 ? (
          <optgroup key={cat.slug} label={cat.name}>
            <option value={cat.slug}>Todo en {cat.name}</option>
            {cat.children.map((child) => (
              <option key={child.slug} value={child.slug}>{child.name}</option>
            ))}
          </optgroup>
        ) : (
          <option key={cat.slug} value={cat.slug}>{cat.name}</option>
        ),
      )}
    </select>
  );
}

/** Localiza la categoría destino en el árbol y devuelve lo que necesita el carry:
 *  su slug, el del padre (para la URL canónica) y su política de tipo (para `condition`). */
function findTarget(tree: Category[], slug: string) {
  for (const root of tree) {
    if (root.slug === slug) {
      return { slug: root.slug, parentSlug: null, allowedListingType: root.allowedListingType };
    }
    const child = (root.children ?? []).find((c) => c.slug === slug);
    if (child) {
      return { slug: child.slug, parentSlug: root.slug, allowedListingType: child.allowedListingType };
    }
  }
  // Slug fuera del árbol: no debería pasar (las opciones salen del propio árbol).
  // Se navega igual, sin padre — el middleware canonicaliza si hace falta.
  return { slug, parentSlug: null, allowedListingType: undefined };
}
