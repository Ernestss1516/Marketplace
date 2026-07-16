import type { ReviewsPageResponse } from '@/types';
import { apiFetch } from './client';

export interface EligibilityResult {
  canReview: boolean;
  /** Reputación RÁFAGA 3 — si el trato que habilita valorar es verificable
   * (hubo conversación) o no, ANTES de enviar la valoración. */
  wouldBeVerified?: boolean;
  alreadyReviewed: boolean;
  existingReview: { id: string; createdAt: string } | null;
}

export interface CreateReviewPayload {
  rating: number;
  comment?: string;
  listingId: string;
  targetId: string;
}

export interface UpdateReviewPayload {
  rating?: number;
  comment?: string;
}

export function getUserReviews(slug: string, params?: { cursor?: string; limit?: number }): Promise<ReviewsPageResponse> {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  const query = qs.toString() ? `?${qs.toString()}` : '';
  return apiFetch<ReviewsPageResponse>(`/users/${slug}/reviews${query}`);
}

export function getEligibility(
  listingId: string,
  targetId: string,
  token: string,
): Promise<EligibilityResult> {
  return apiFetch<EligibilityResult>(
    `/reviews/eligibility?listingId=${encodeURIComponent(listingId)}&targetId=${encodeURIComponent(targetId)}`,
    { token },
  );
}

export function createReview(payload: CreateReviewPayload, token: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>('/reviews', {
    method: 'POST',
    body: JSON.stringify(payload),
    token,
  });
}

export function editReview(id: string, payload: UpdateReviewPayload, token: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/reviews/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    token,
  });
}
