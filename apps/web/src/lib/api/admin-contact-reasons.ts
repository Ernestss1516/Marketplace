import { apiFetch } from './client';

export interface AdminContactReason {
  id: string;
  nombre: string;
  orden: number;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

/** GET /admin/contact-reasons — TODOS (incluidos inactivos: el filtro del
 * listado de mensajes y este propio panel los necesitan). */
export function getAdminContactReasons(token: string): Promise<AdminContactReason[]> {
  return apiFetch<AdminContactReason[]>('/admin/contact-reasons', { token, cache: 'no-store' });
}

export function createAdminContactReason(
  token: string,
  dto: { nombre: string },
): Promise<AdminContactReason> {
  return apiFetch<AdminContactReason>('/admin/contact-reasons', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

export function updateAdminContactReason(
  token: string,
  id: string,
  dto: { nombre?: string; activo?: boolean },
): Promise<AdminContactReason> {
  return apiFetch<AdminContactReason>(`/admin/contact-reasons/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}

export function reorderAdminContactReasons(
  token: string,
  items: { id: string; orden: number }[],
): Promise<void> {
  return apiFetch('/admin/contact-reasons/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ items }),
    token,
  });
}
