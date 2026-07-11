import type { Alert, AlertCriteria, AlertsResponse, ListingSummary } from '@/types';
import { apiFetch } from './client';

// Los "matches" de una alerta nunca pasan por SearchController (alerts.service.ts
// llama a SearchService.search() directamente) — nunca pueden traer un
// SponsoredAdHit, así que no reutilizan el SearchResponse de busqueda.ts.
export interface AlertMatchesResponse {
  hits: ListingSummary[];
  totalHits: number;
  page: number;
  hitsPerPage: number;
  facets?: Record<string, Record<string, number>>;
}

export function createAlert(
  payload: AlertCriteria & { name: string },
  token: string,
): Promise<{ alert: Alert; matches: AlertMatchesResponse }> {
  return apiFetch('/alerts', { method: 'POST', body: JSON.stringify(payload), token });
}

export function getMyAlerts(token: string, page = 1, perPage = 20): Promise<AlertsResponse> {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  return apiFetch<AlertsResponse>(`/alerts?${params}`, { token });
}

export function updateAlert(
  id: string,
  payload: Partial<AlertCriteria> & { name?: string; active?: boolean },
  token: string,
): Promise<Alert> {
  return apiFetch(`/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(payload), token });
}

export function deleteAlert(id: string, token: string): Promise<void> {
  return apiFetch(`/alerts/${id}`, { method: 'DELETE', token });
}

export function getAlertMatches(id: string, token: string): Promise<AlertMatchesResponse> {
  return apiFetch<AlertMatchesResponse>(`/alerts/${id}/matches`, { token });
}
