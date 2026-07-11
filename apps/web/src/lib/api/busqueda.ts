import type { ListingSummary, SponsoredAdHit } from '@/types';
import { apiFetch } from './client';

export type SearchHit = ListingSummary | SponsoredAdHit;

export interface SearchParams {
  q?: string;
  category?: string;
  type?: 'PRODUCT' | 'SERVICE';
  condition?: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'FOR_PARTS';
  priceType?: 'FIXED' | 'FREE' | 'NEGOTIABLE';
  minPrice?: number;
  maxPrice?: number;
  province?: string;
  city?: string;
  lat?: number;
  lng?: number;
  radius?: number;
  sort?: 'price:asc' | 'price:desc' | 'publishedAt:desc';
  page?: number;
  hitsPerPage?: number;
  [key: string]: string | number | undefined;
}

export interface SearchResponse {
  hits: SearchHit[];
  totalHits: number;
  page: number;
  hitsPerPage: number;
  facets?: Record<string, Record<string, number>>;
}

export function search(params: SearchParams): Promise<SearchResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return apiFetch<SearchResponse>(`/search?${query}`);
}
