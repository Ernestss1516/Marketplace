import { apiFetch } from './client';

/** B1 — un tag del catálogo, tal cual lo devuelve el admin (con orden y activo). */
export interface AdminTag {
  id: string;
  slug: string;
  name: string;
  orden: number;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Lo que ve el público: identificar, filtrar y mostrar. */
export interface TagRef {
  id: string;
  slug: string;
  name: string;
}

export interface AdminTagList {
  items: AdminTag[];
  total: number;
  page: number;
  perPage: number;
}

/** GET /admin/tags — TODOS (activos e inactivos: el admin necesita ver lo que desactivó
 *  para poder reactivarlo). `q` busca por nombre. */
export function getAdminTags(
  token: string,
  params: { q?: string; page?: number; perPage?: number } = {},
): Promise<AdminTagList> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.page) qs.set('page', String(params.page));
  if (params.perPage) qs.set('perPage', String(params.perPage));
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiFetch<AdminTagList>(`/admin/tags${suffix}`, { token, cache: 'no-store' });
}

export function createAdminTag(
  token: string,
  dto: { name: string; slug?: string },
): Promise<AdminTag> {
  return apiFetch<AdminTag>('/admin/tags', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

/** `slug` no viaja: es inmutable (URL + indexado). Se renombra con `name`. */
export function updateAdminTag(
  token: string,
  id: string,
  dto: { name?: string; orden?: number; activo?: boolean },
): Promise<AdminTag> {
  return apiFetch<AdminTag>(`/admin/tags/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}

export function reorderAdminTags(
  token: string,
  items: { id: string; orden: number }[],
): Promise<void> {
  return apiFetch(`/admin/tags/reorder`, {
    method: 'PATCH',
    body: JSON.stringify({ items }),
    token,
  });
}

/** Para avisar ANTES de desactivar: a cuántos anuncios y categorías afecta. */
export function getAdminTagUsage(
  token: string,
  id: string,
): Promise<{ listingCount: number; categoryCount: number }> {
  return apiFetch(`/admin/tags/${id}/usage`, { token, cache: 'no-store' });
}

// ── Asignación por categoría ────────────────────────────────────────────────

/** `inherited` viene del padre y es SOLO LECTURA desde aquí — se edita en el padre. */
export function getCategoryTags(
  token: string,
  categoryId: string,
): Promise<{ own: TagRef[]; inherited: TagRef[] }> {
  return apiFetch(`/admin/categories/${categoryId}/tags`, { token, cache: 'no-store' });
}

/** Reemplaza el set PROPIO. No toca los heredados. */
export function setCategoryTags(
  token: string,
  categoryId: string,
  tagIds: string[],
): Promise<{ own: TagRef[]; inherited: TagRef[] }> {
  return apiFetch(`/admin/categories/${categoryId}/tags`, {
    method: 'PUT',
    body: JSON.stringify({ tagIds }),
    token,
  });
}
