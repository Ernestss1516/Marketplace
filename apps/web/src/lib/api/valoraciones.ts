import type { ReviewsPageResponse } from '@/types';
import { apiFetch } from './client';

export function getUserReviews(slug: string, params?: { cursor?: string; limit?: number }): Promise<ReviewsPageResponse> {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  const query = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<ReviewsPageResponse>(`/users/${slug}/reviews${query}`);
}
