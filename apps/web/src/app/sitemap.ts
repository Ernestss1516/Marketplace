import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/config';
import { getPostList, getPageList } from '@/lib/api/blog';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Only PUBLISHED posts are returned by getPostList (calls GET /blog, type=POST
  // enforced backend-side). getPageList calls GET /paginas (type=PAGE) — separate
  // endpoint, separate URL namespace.
  const [{ items: posts }, { items: pages }] = await Promise.all([
    getPostList({ perPage: 500 }).catch(() => ({ items: [] })),
    getPageList({ perPage: 500 }).catch(() => ({ items: [] })),
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
