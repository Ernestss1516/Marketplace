import { unstable_cache } from 'next/cache';
import type { Post, PostSummary, PaginatedResponse } from '@/types';
import { apiFetch } from './client';

export function getPostList(opts?: {
  page?: number;
  perPage?: number;
  tag?: string;
}): Promise<PaginatedResponse<PostSummary>> {
  const params = new URLSearchParams();
  if (opts?.page && opts.page > 1) params.set('page', String(opts.page));
  if (opts?.perPage) params.set('perPage', String(opts.perPage));
  if (opts?.tag) params.set('tag', opts.tag);
  const qs = params.toString();
  return apiFetch<PaginatedResponse<PostSummary>>(`/blog${qs ? `?${qs}` : ''}`);
}

export function getPost(slug: string): Promise<Post> {
  return apiFetch<Post>(`/blog/${slug}`);
}

// Páginas informativas (términos, privacidad...) — mismo shape que un post,
// namespace /paginas en vez de /blog. getPageList solo lo usa el sitemap; no hay
// listado de páginas en la UI pública (se enlazan manualmente).
export function getPageList(opts?: { perPage?: number }): Promise<PaginatedResponse<PostSummary>> {
  const params = new URLSearchParams();
  if (opts?.perPage) params.set('perPage', String(opts.perPage));
  const qs = params.toString();
  return apiFetch<PaginatedResponse<PostSummary>>(`/paginas${qs ? `?${qs}` : ''}`);
}

export function getPage(slug: string): Promise<Post> {
  return apiFetch<Post>(`/paginas/${slug}`);
}

export interface FooterPage {
  title: string;
  slug: string;
}

function getFooterPages(): Promise<FooterPage[]> {
  return apiFetch<FooterPage[]>('/paginas/footer');
}

// El footer vive en un layout compartido por páginas con dinamismo dispar
// (/blog es ISR a 3600s, /busqueda es esencialmente dinámica) — atarlo al
// revalidate de una ruta concreta no tiene sentido. unstable_cache lo aísla por
// completo: la query nunca corre por request, solo cuando el TTL expira (red de
// seguridad, no la vía principal) o cuando revalidateTag('footer-pages') se
// dispara explícitamente desde BlogService al publicar/despublicar/editar/
// borrar una PAGE (ver /api/revalidate).
export const getCachedFooterPages = unstable_cache(
  () => getFooterPages(),
  ['footer-pages'],
  { revalidate: 3600, tags: ['footer-pages'] },
);
