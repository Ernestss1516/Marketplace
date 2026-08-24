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
  /**
   * V-4 — «solo con vídeo». Se serializa como `?conVideo=true`, y el backend sólo lo
   * acepta así: cualquier otro valor queda en «no filtrar». Por eso aquí se pasa
   * `undefined` en vez de `false` cuando está desactivado — mandar `conVideo=false`
   * ensuciaría la URL con un parámetro que no hace nada.
   */
  conVideo?: boolean;
  [key: string]: string | number | boolean | undefined;
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
//
// `headers`: ESTADÍSTICAS A1 — la identidad del visitante que el BFF reenvía a Nest
// para el dedup de impresiones (ver `lib/visitor.ts`). Sólo la pasan las superficies
// que sirven RESULTADOS DE BÚSQUEDA (`/busqueda`, `/[categoria]`); los bloques
// curados de portada y blog no la pasan a propósito — no son resultados de una
// búsqueda de nadie, y además van por caché de fetch, así que casi nunca llegan al
// backend. Ver docs/diseno-estadisticas.md §2.1.
export function search(
  params: SearchParams,
  fetchOptions?: {
    next?: { revalidate?: number; tags?: string[] };
    headers?: Record<string, string>;
  },
): Promise<SearchResponse> {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return apiFetch<SearchResponse>(`/search?${query}`, fetchOptions);
}
