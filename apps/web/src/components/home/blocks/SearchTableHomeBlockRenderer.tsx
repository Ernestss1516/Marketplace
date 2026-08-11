import Link from 'next/link';
import type {
  HomeSearchTableBlock,
  SearchTableColumns,
  SearchTableTab,
} from '@/types/home-blocks';
import type { Category } from '@/types';
import { PROVINCIAS } from '@/lib/provincias';
import { categoryPath, categoryPathWithQuery, findCategoryUrlParts } from '@/lib/category-url';
import { recorrerArbol } from '@/lib/category-tree';
import { SearchTabs } from './SearchTabs';

/**
 * Tabla de búsquedas. **Server Component**: los tres paneles se pintan AQUÍ y
 * viajan enteros en el HTML servido; el island de al lado solo cambia cuál se ve.
 *
 * Es el bloque con más valor SEO del motor —son cientos de enlaces internos a
 * búsquedas— y de ahí la propiedad que lo gobierna todo: **el contenido de todas
 * las pestañas activas está en el HTML aunque el usuario solo vea una**.
 *
 * Ninguna URL se concatena a mano: las tres clases de pestaña pasan por los
 * helpers de `category-url.ts` o por el mismo destino al que navega el buscador
 * (regla de proyecto, lib/category-url.ts:5-9).
 */

/** Clases ESTÁTICAS: Tailwind purga lo que no ve escrito. */
const COLUMN_CLASS: Record<SearchTableColumns, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 md:grid-cols-3',
  4: 'sm:grid-cols-2 md:grid-cols-4',
};

const ENLACE_CLS = 'truncate text-sm text-muted-foreground transition-colors hover:text-primary';

function Panel({
  enlaces,
  columns,
}: {
  enlaces: { href: string; texto: string }[];
  columns: SearchTableColumns;
}) {
  if (enlaces.length === 0) return null;
  return (
    <ul className={`grid gap-x-6 gap-y-2 ${COLUMN_CLASS[columns]}`}>
      {enlaces.map((e) => (
        <li key={e.href}>
          <Link href={e.href} className={ENLACE_CLS}>
            {e.texto}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Construye los enlaces de una pestaña. Devuelve [] si no hay nada que pintar. */
function enlacesDe(tab: SearchTableTab, categories: Category[]): { href: string; texto: string }[] {
  if (tab.kind === 'locations') {
    // Las 52 provincias, sin consultar nada: es una constante del frontend.
    // El destino es el mismo al que navega el buscador cuando no hay categoría
    // elegida (SearchBar.navegar).
    return PROVINCIAS.map((provincia) => ({
      href: `/busqueda?${new URLSearchParams({ province: provincia })}`,
      texto: provincia,
    }));
  }

  if (tab.kind === 'categories') {
    const raices = categories.map((c) => ({ href: categoryPath(c), texto: c.name }));
    if (!tab.includeChildren) return raices;
    // PROFUNDIDAD N — RÁFAGA 3: recorrido recursivo. Cada descendiente con su
    // path completo («Vehículos › Coches › Deportivos») y su URL anidada. Antes
    // bajaba un solo nivel, así que una tabla con `includeChildren` no llegaba a
    // enseñar nada por debajo de la hija.
    const bajar = (
      nodos: Category[],
      ancestorSlugs: string[],
      ancestorNames: string[],
    ): { href: string; texto: string }[] =>
      nodos.flatMap((cat) => [
        {
          href: categoryPath({ slug: cat.slug, ancestorSlugs }),
          texto: [...ancestorNames, cat.name].join(' › '),
        },
        ...bajar(cat.children ?? [], [...ancestorSlugs, cat.slug], [...ancestorNames, cat.name]),
      ]);
    return bajar(categories, [], []);
  }

  // combos: pares categoría+provincia configurados por el admin.
  return tab.items
    .map((combo) => {
      const urlParts = findCategoryUrlParts(categories, combo.categorySlug);
      // Categoría borrada → se omite, no se deja un enlace a un 404. Misma
      // doctrina "se acepta al escribir, se oculta al leer" que el carrusel.
      if (!urlParts) return null;
      // Provincia que no está en la lista → se omite. El backend NO la valida
      // (PROVINCIAS es una constante del frontend, ver el DTO); el filtro vive
      // aquí, que es donde se sabe.
      // El `as readonly string[]` es necesario: PROVINCIAS es una tupla literal,
      // así que `includes` exigiría que el argumento fuera ya una de las 52 —
      // justo lo que aquí no se sabe todavía y se quiere comprobar.
      if (!(PROVINCIAS as readonly string[]).includes(combo.province)) return null;

      const categoria = categories
        .flatMap((c) => recorrerArbol([c]))
        .find((c) => c.slug === combo.categorySlug);

      return {
        href: categoryPathWithQuery(urlParts, new URLSearchParams({ province: combo.province })),
        texto: `${categoria?.name ?? combo.categorySlug} en ${combo.province}`,
      };
    })
    .filter((e): e is { href: string; texto: string } => e !== null);
}

export function SearchTableHomeBlockRenderer({
  block,
  categories = [],
}: {
  block: HomeSearchTableBlock;
  categories?: Category[];
}) {
  const columns = block.columns ?? 3;

  // Los paneles se construyen en SERVIDOR y se pasan ya renderizados al island.
  const tabs = block.tabs
    .map((tab) => ({ tab, enlaces: enlacesDe(tab, categories) }))
    .filter(({ enlaces }) => enlaces.length > 0)
    .map(({ tab, enlaces }) => ({
      id: tab.kind,
      label: tab.label,
      panel: <Panel enlaces={enlaces} columns={columns} />,
    }));

  if (tabs.length === 0) return null;

  return (
    <div>
      {block.title && <h2 className="mb-4 text-xl font-semibold">{block.title}</h2>}
      <SearchTabs tabs={tabs} />
    </div>
  );
}
