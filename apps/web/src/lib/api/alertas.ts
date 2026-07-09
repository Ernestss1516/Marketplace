import type { Alert, AlertCriteria, AlertsResponse } from '@/types';
import type { SearchResponse } from './busqueda';
import { apiFetch } from './client';

export function createAlert(
  payload: AlertCriteria & { name: string },
  token: string,
): Promise<{ alert: Alert; matches: SearchResponse }> {
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

export function getAlertMatches(id: string, token: string): Promise<SearchResponse> {
  return apiFetch<SearchResponse>(`/alerts/${id}/matches`, { token });
}
