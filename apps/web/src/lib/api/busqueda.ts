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
  sort?: 'price:asc' | 'price:desc' | 'publishedAt:desc' | 'sortDate:desc';
  page?: number;
  hitsPerPage?: number;
  [key: string]: string | number | undefined;
}

export interface SearchResponse {
  hits: SearchHit[];
  /** Bloque "Promocionados" (política de ordenación C): hasta 4 destacados que
   * cumplen los mismos filtros, solo en página 1. Se muestran ADEMÁS de su
   * posición natural en `hits` — no se restan de `totalHits`. Ausente en los
   * fallbacks locales (p. ej. cuando falla la búsqueda) — tratar como []. */
  featured?: ListingSummary[];
  totalHits: number;
  page: number;
  hitsPerPage: number;
  facets?: Record<string, Record<string, number>>;
}

// `next`: opciones de caché de fetch de Next.js, opcionales — usado por el
// bloque `listings` (Ráfaga 3) para pasar un revalidate corto propio sin
// afectar a los demás llamadores (home, /busqueda, /[categoria]), que no lo
// pasan y siguen con el comportamiento de caché por defecto de esa página.
export function search(
  params: SearchParams,
  fetchOptions?: { next?: { revalidate?: number; tags?: string[] } },
): Promise<SearchResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return apiFetch<SearchResponse>(`/search?${query}`, fetchOptions);
}
