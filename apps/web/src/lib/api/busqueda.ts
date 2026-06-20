import type { ListingSummary } from '@/types';
import { apiFetch } from './client';

export interface SearchParams {
  q?: string;
  category?: string;
  type?: 'PRODUCT' | 'SERVICE';
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
  hits: ListingSummary[];
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
