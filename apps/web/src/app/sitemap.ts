import type { MetadataRoute } from 'next';
import type { PostSummary } from '@/types';
import { SITE_URL } from '@/config';
import { getPostList, getPageList } from '@/lib/api/blog';
import { getCategories } from '@/lib/api/categorias';
import { categoryPath } from '@/lib/category-url';

/**
 * A1 — generado EN CADA PETICIÓN, no en el build.
 *
 * Por defecto Next prerenderiza esta ruta durante `next build` (deja un
 * `.next/server/app/sitemap.xml.body` congelado). Eso tiene dos problemas, y el
 * primero se encontró ejerciéndolo, no razonándolo: si la API no está levantada
 * durante el build, las tres llamadas de abajo caen a su `.catch(() => …)` y el
 * sitemap se publica **sin una sola categoría ni entrada de blog**, en silencio y
 * con un 200. Un sitemap vacío es peor que no tenerlo: le dice al buscador que el
 * sitio no tiene nada.
 *
 * El segundo: aunque el build sí alcance la API, el contenido queda congelado hasta
 * el siguiente despliegue — una categoría nueva no aparecería hasta entonces.
 *
 * Un sitemap lo pide un crawler de vez en cuando, no un usuario en cada visita, así
 * que generarlo por petición no está en ninguna ruta caliente.
 */
export const dynamic = 'force-dynamic';

/** Tamaño de página al recorrer el listado. Holgado pero DENTRO del tope del
 *  backend (`@Max(500)` en los DTO de blog) — pedir por encima del tope devolvía
 *  400, y ese era justo el bug: ver `traerTodo` abajo. */
const POR_PAGINA = 200;

/**
 * Recorre TODAS las páginas del listado en vez de pedir "muchos de golpe".
 *
 * El sitemap pedía `perPage: 500` de una tacada y envolvía la llamada en un
 * `.catch(() => ({ items: [] }))`. Dos problemas encadenados:
 *
 *  1. El tope del DTO estaba en 50, así que la petición respondía **400** —
 *     siempre, no en un caso raro.
 *  2. El `.catch` silencioso lo convertía en una lista vacía, y el sitemap se
 *     publicaba con 200 y **sin un solo post ni página**. En un proyecto que vive
 *     del SEO, ese era el peor desenlace posible, y era invisible.
 *
 * Subir el tope arregla (1). Recorrer el listado evita que (1) vuelva por la
 * puerta de atrás cuando el blog crezca: con un número fijo, el día que haya más
 * posts que ese número el sitemap volvería a estar incompleto — otra vez en
 * silencio. Aquí se pide hasta agotar `total`.
 *
 * Y si algo falla, **se grita**: se registra el error con el detalle en vez de
 * devolver una lista vacía sin más. Se devuelve lo acumulado hasta el fallo (un
 * sitemap parcial le sirve más a un buscador que un 500), pero el fallo queda en
 * los logs, que es lo que no pasaba antes.
 */
async function traerTodo(
  nombre: string,
  cargar: (page: number) => Promise<{ items: PostSummary[]; total?: number }>,
): Promise<PostSummary[]> {
  const acumulado: PostSummary[] = [];
  // Tope de vueltas: red de seguridad para que un `total` incoherente no cuelgue
  // la generación del sitemap. 50 × 200 = 10.000 URLs, muy por encima de lo real.
  for (let page = 1; page <= 50; page++) {
    try {
      const res = await cargar(page);
      acumulado.push(...res.items);
      if (res.items.length === 0 || acumulado.length >= (res.total ?? 0)) break;
    } catch (err) {
      console.error(
        `[sitemap] fallo cargando "${nombre}" en la página ${page}: ${
          err instanceof Error ? err.message : String(err)
        }. El sitemap saldrá INCOMPLETO (${acumulado.length} entradas de "${nombre}").`,
      );
      break;
    }
  }
  return acumulado;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Only PUBLISHED posts are returned by getPostList (calls GET /blog, type=POST
  // enforced backend-side). getPageList calls GET /paginas (type=PAGE) — separate
  // endpoint, separate URL namespace.
  const [posts, pages, categories] = await Promise.all([
    traerTodo('blog', (page) => getPostList({ page, perPage: POR_PAGINA })),
    traerTodo('paginas', (page) => getPageList({ page, perPage: POR_PAGINA })),
    getCategories().catch((err) => {
      console.error(
        `[sitemap] fallo cargando categorías: ${err instanceof Error ? err.message : String(err)}. ` +
          `El sitemap saldrá SIN categorías.`,
      );
      return [];
    }),
  ]);

  // A1 (URLs anidadas) — las categorías NO estaban en el sitemap (ni antes de esta
  // ráfaga). Se añaden ahora, y con la URL ANIDADA: además de ser una mejora de SEO
  // por sí misma, es el canal por el que un buscador descubre rápido las URLs nuevas
  // en lugar de esperar a recrawlear las viejas y seguir sus redirects.
  // Raíces e hijas por igual — ambas son páginas de listado indexables.
  // Sin `lastModified`: Category no tiene columna de fecha, y una fecha inventada
  // (new Date()) le diría al crawler que TODAS cambian en cada build, que es peor
  // señal que no dar ninguna.
  // PROFUNDIDAD N — RÁFAGA 3: recorrido recursivo. Era `raíces + un nivel de
  // hijas`, así que una categoría de nivel 3 o 4 no habría entrado NUNCA en el
  // sitemap: existiría, se podría navegar, y ningún buscador la descubriría.
  // Para las de 1-2 niveles produce exactamente las mismas URLs que antes.
  const recorrer = (
    nodos: typeof categories,
    ancestorSlugs: string[],
  ): MetadataRoute.Sitemap =>
    nodos.flatMap((cat) => [
      {
        url: `${SITE_URL}${categoryPath({ slug: cat.slug, ancestorSlugs })}`,
        changeFrequency: 'daily' as const,
        priority: 0.8,
      },
      ...recorrer((cat.children ?? []) as typeof categories, [...ancestorSlugs, cat.slug]),
    ]);

  const categoryEntries: MetadataRoute.Sitemap = recorrer(categories, []);

  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${SITE_URL}/busqueda`,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/blog`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    ...categoryEntries,
    ...posts.map((p) => ({
      url: `${SITE_URL}/blog/${p.slug}`,
      lastModified: new Date(p.updatedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    ...pages.map((p) => ({
      url: `${SITE_URL}/paginas/${p.slug}`,
      lastModified: new Date(p.updatedAt),
      changeFrequency: 'yearly' as const,
      priority: 0.5,
    })),
  ];
}
