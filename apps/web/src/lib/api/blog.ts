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
export function getPageList(opts?: {
  page?: number;
  perPage?: number;
}): Promise<PaginatedResponse<PostSummary>> {
  const params = new URLSearchParams();
  if (opts?.page && opts.page > 1) params.set('page', String(opts.page));
  if (opts?.perPage) params.set('perPage', String(opts.perPage));
  const qs = params.toString();
  return apiFetch<PaginatedResponse<PostSummary>>(`/paginas${qs ? `?${qs}` : ''}`);
}

export function getPage(slug: string): Promise<Post> {
  return apiFetch<Post>(`/paginas/${slug}`);
}
