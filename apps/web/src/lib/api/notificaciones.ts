import type { NotificationsResponse } from '@/types';
import { apiFetch } from './client';

export async function getMyNotifications(
  token: string,
  page = 1,
  perPage = 20,
): Promise<NotificationsResponse> {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  return apiFetch<NotificationsResponse>(`/notifications?${params}`, { token });
}

export function getUnreadNotificationsCount(token: string): Promise<{ count: number }> {
  return apiFetch<{ count: number }>('/notifications/unread-count', { token });
}

export function markNotificationRead(id: string, token: string): Promise<{ success: true }> {
  return apiFetch<{ success: true }>(`/notifications/${id}/read`, { method: 'POST', token });
}

export function markAllNotificationsRead(token: string): Promise<{ success: true }> {
  return apiFetch<{ success: true }>('/notifications/read-all', { method: 'POST', token });
}
