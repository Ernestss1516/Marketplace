import { apiFetch } from './client';

export type FooterItemType = 'PAGE' | 'INTERNAL' | 'EXTERNAL';

export interface AdminFooterItemPage {
  id: string;
  title: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED';
}

export interface AdminFooterItem {
  id: string;
  columnId: string;
  label: string;
  order: number;
  type: FooterItemType;
  pageId: string | null;
  url: string | null;
  // Solo presente cuando type=PAGE — status incluido para pintar el badge
  // "en borrador — no se muestra" sin una llamada aparte.
  page: AdminFooterItemPage | null;
}

export interface AdminFooterColumn {
  id: string;
  name: string | null;
  order: number;
  items: AdminFooterItem[];
}

export function getAdminFooter(token: string): Promise<AdminFooterColumn[]> {
  return apiFetch<AdminFooterColumn[]>('/admin/footer', { token });
}

// ─── Columns ────────────────────────────────────────────────────────────────

export function createFooterColumn(
  token: string,
  dto: { name?: string; order?: number },
): Promise<AdminFooterColumn> {
  return apiFetch<AdminFooterColumn>('/admin/footer/columns', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

export function updateFooterColumn(
  token: string,
  id: string,
  dto: { name?: string | null; order?: number },
): Promise<AdminFooterColumn> {
  return apiFetch<AdminFooterColumn>(`/admin/footer/columns/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}

export function deleteFooterColumn(token: string, id: string): Promise<void> {
  return apiFetch<void>(`/admin/footer/columns/${id}`, { method: 'DELETE', token });
}

export function reorderFooterColumns(
  token: string,
  items: { id: string; order: number }[],
): Promise<void> {
  return apiFetch('/admin/footer/columns/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ items }),
    token,
  });
}

// ─── Items ──────────────────────────────────────────────────────────────────

export interface FooterItemDestinationPayload {
  type: FooterItemType;
  // PAGE → pageId obligatorio, url ausente. INTERNAL/EXTERNAL → url
  // obligatorio, pageId ausente. Validado en el backend (FooterService).
  pageId?: string;
  url?: string;
}

export function createFooterItem(
  token: string,
  dto: { columnId: string; label: string; order?: number } & FooterItemDestinationPayload,
): Promise<AdminFooterItem> {
  return apiFetch<AdminFooterItem>('/admin/footer/items', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

// "Mover de columna" = incluir columnId aquí. Tocar el destino (type/pageId/
// url) exige mandar la combinación COMPLETA para el nuevo type — ver
// FooterService.updateItem.
export function updateFooterItem(
  token: string,
  id: string,
  dto: Partial<{ columnId: string; label: string; order: number } & FooterItemDestinationPayload>,
): Promise<AdminFooterItem> {
  return apiFetch<AdminFooterItem>(`/admin/footer/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}

export function deleteFooterItem(token: string, id: string): Promise<void> {
  return apiFetch<void>(`/admin/footer/items/${id}`, { method: 'DELETE', token });
}

export function reorderFooterItems(
  token: string,
  items: { id: string; order: number }[],
): Promise<void> {
  return apiFetch('/admin/footer/items/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ items }),
    token,
  });
}
