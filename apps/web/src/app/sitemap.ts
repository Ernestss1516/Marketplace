import type { MetadataRoute } from 'next';
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Only PUBLISHED posts are returned by getPostList (calls GET /blog, type=POST
  // enforced backend-side). getPageList calls GET /paginas (type=PAGE) — separate
  // endpoint, separate URL namespace.
  const [{ items: posts }, { items: pages }, categories] = await Promise.all([
    getPostList({ perPage: 500 }).catch(() => ({ items: [] })),
    getPageList({ perPage: 500 }).catch(() => ({ items: [] })),
    getCategories().catch(() => []),
  ]);

  // A1 (URLs anidadas) — las categorías NO estaban en el sitemap (ni antes de esta
  // ráfaga). Se añaden ahora, y con la URL ANIDADA: además de ser una mejora de SEO
  // por sí misma, es el canal por el que un buscador descubre rápido las URLs nuevas
  // en lugar de esperar a recrawlear las viejas y seguir sus redirects.
  // Raíces e hijas por igual — ambas son páginas de listado indexables.
  // Sin `lastModified`: Category no tiene columna de fecha, y una fecha inventada
  // (new Date()) le diría al crawler que TODAS cambian en cada build, que es peor
  // señal que no dar ninguna.
  const categoryEntries: MetadataRoute.Sitemap = categories.flatMap((root) => [
    {
      url: `${SITE_URL}${categoryPath(root)}`,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    },
    ...(root.children ?? []).map((child) => ({
      url: `${SITE_URL}${categoryPath({ slug: child.slug, parentSlug: root.slug })}`,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
  ]);

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
