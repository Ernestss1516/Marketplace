import { apiFetch } from './client';

/**
 * ESTADÍSTICAS B1 — el cliente de la telemetría agregada del backoffice.
 *
 * Fichero propio y no dentro de `admin.ts` (785 líneas ya): es un endpoint nuevo, de un
 * controlador nuevo y con su propio piso de rol. Mismo criterio que `admin-tags.ts`,
 * `admin-facturas.ts` o `admin-banners.ts`, que también salieron aparte.
 */

/** Las tres ventanas que ofrece la interfaz; el backend rechaza cualquier otra. */
export const RANGOS_ESTADISTICAS = [7, 30, 90] as const;
export type RangoEstadisticas = (typeof RANGOS_ESTADISTICAS)[number];

export interface SerieDiaria {
  date: string;
  count: number;
}

export interface RatioConMuestra {
  value: number | null;
  minSample: number;
}

/** Lo que comparten la actividad de un anuncio y la de un usuario. */
export interface ActividadBase {
  days: RangoEstadisticas;
  viewCount: number;
  impressionCount: number;
  favoritesCount: number;
  dailyViews: SerieDiaria[];
  dailyImpressions: SerieDiaria[];
  ctr: { value: number | null; views: number; impressions: number; minImpressions: number };
  likeRatio: { value: number | null; favorites: number; views: number; minViews: number };
}

export interface ActividadAnuncio extends ActividadBase {
  title: string;
}

export interface ActividadUsuario extends ActividadBase {
  name: string;
  listingCount: number;
  mostViewed: { id: string; title: string; viewCount: number } | null;
  mostListed: { id: string; title: string; impressionCount: number } | null;
}

export function getActividadAnuncio(
  id: string,
  days: RangoEstadisticas,
  token: string,
): Promise<ActividadAnuncio> {
  return apiFetch<ActividadAnuncio>(`/admin/stats/listings/${id}?days=${days}`, {
    token,
    cache: 'no-store',
  });
}

export function getActividadUsuario(
  id: string,
  days: RangoEstadisticas,
  token: string,
): Promise<ActividadUsuario> {
  return apiFetch<ActividadUsuario>(`/admin/stats/users/${id}?days=${days}`, {
    token,
    cache: 'no-store',
  });
}

// ── B2 — categoría y pulso de plataforma ────────────────────────────────────

export interface ActividadCategoria extends ActividadBase {
  name: string;
  slug: string;
  /** Si los números incluyen las subcategorías. Por defecto sí — ver el backend. */
  subtree: boolean;
  /** Cuántas subcategorías se están sumando, para poder decirlo. */
  descendantCount: number;
  listingCount: number;
  mostViewed: { id: string; title: string; viewCount: number } | null;
  mostListed: { id: string; title: string; impressionCount: number } | null;
}

export interface FilaPulso {
  id: string;
  name: string;
  slug: string;
  activeListings: number;
  views: number;
  impressions: number;
  /** `null` = aún no hay apariciones suficientes para un porcentaje honesto. */
  ctr: number | null;
  ctrMinImpressions: number;
  /** `null` = el periodo anterior fue cero; no hay variación que calcular. */
  viewsDelta: number | null;
  impressionsDelta: number | null;
}

export interface PulsoPlataforma {
  days: RangoEstadisticas;
  totals: {
    views: number;
    impressions: number;
    activeListings: number;
    ctr: number | null;
    ctrMinImpressions: number;
  };
  dailyViews: SerieDiaria[];
  dailyImpressions: SerieDiaria[];
  categories: Array<FilaPulso & { children: FilaPulso[] }>;
}

export function getActividadCategoria(
  id: string,
  days: RangoEstadisticas,
  token: string,
  subtree = true,
): Promise<ActividadCategoria> {
  return apiFetch<ActividadCategoria>(
    `/admin/stats/categories/${id}?days=${days}&subtree=${subtree}`,
    { token, cache: 'no-store' },
  );
}

export function getPulsoPlataforma(
  days: RangoEstadisticas,
  token: string,
): Promise<PulsoPlataforma> {
  return apiFetch<PulsoPlataforma>(`/admin/stats/platform?days=${days}`, {
    token,
    cache: 'no-store',
  });
}
