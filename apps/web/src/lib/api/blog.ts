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
