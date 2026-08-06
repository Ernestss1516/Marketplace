import { apiFetch } from './client';
import type { NavPageType } from './nav';

export type NavItemType = 'PAGE' | 'INTERNAL' | 'EXTERNAL';

export interface AdminNavItemPage {
  id: string;
  title: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED';
}

/**
 * Nodo tal como lo devuelve GET /admin/nav: SIN podar (a diferencia del público),
 * así que incluye nodos inactivos, con la página en borrador o temporalmente
 * inválidos —sin destino y sin hijos—. El admin necesita verlos para arreglarlos.
 *
 * `type: null` = nodo solo-desplegable. Es la diferencia estructural con
 * AdminFooterItem, cuyo `type` es obligatorio.
 */
export interface AdminNavItem {
  id: string;
  parentId: string | null;
  label: string;
  order: number;
  active: boolean;
  type: NavItemType | null;
  pageId: string | null;
  url: string | null;
  visibleOn: NavPageType[];
  /** Solo cuando type=PAGE — status incluido para el badge "en borrador" sin otra llamada. */
  page: AdminNavItemPage | null;
  /** Solo en los nodos raíz; los hijos no traen hijos (NAV_MAX_DEPTH = 2). */
  children?: AdminNavItem[];
}

export function getAdminNav(token: string): Promise<AdminNavItem[]> {
  return apiFetch<AdminNavItem[]>('/admin/nav', { token });
}

/**
 * Destino DISCRIMINADO y OPCIONAL. `type: null` es un valor legítimo: crea un
 * nodo solo-desplegable, sin destino propio. La coherencia (PAGE → pageId;
 * INTERNAL/EXTERNAL → url) la valida el backend en NavService.
 */
export interface NavDestinationPayload {
  type: NavItemType | null;
  pageId?: string;
  url?: string;
}

export function createNavItem(
  token: string,
  dto: {
    parentId?: string;
    label: string;
    order?: number;
    active?: boolean;
    visibleOn?: NavPageType[];
  } & Partial<NavDestinationPayload>,
): Promise<AdminNavItem> {
  return apiFetch<AdminNavItem>('/admin/nav/items', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

/**
 * MOVER en el árbol = mandar `parentId` aquí; no hay endpoint aparte (mismo
 * criterio que "mover de columna" en el footer). `parentId: null` promueve el
 * nodo a raíz.
 *
 * Tocar el destino exige mandar la combinación COMPLETA para el nuevo `type`,
 * no mezclarla con lo guardado — ver NavService.updateItem.
 */
export function updateNavItem(
  token: string,
  id: string,
  dto: Partial<{
    parentId: string | null;
    label: string;
    order: number;
    active: boolean;
    visibleOn: NavPageType[];
  }> &
    Partial<NavDestinationPayload>,
): Promise<AdminNavItem> {
  return apiFetch<AdminNavItem>(`/admin/nav/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}

/** Se lleva el subárbol por cascade — la UI anuncia cuántos descendientes antes de confirmar. */
export function deleteNavItem(token: string, id: string): Promise<void> {
  return apiFetch<void>(`/admin/nav/items/${id}`, { method: 'DELETE', token });
}

export function reorderNavItems(
  token: string,
  items: { id: string; order: number }[],
): Promise<void> {
  return apiFetch('/admin/nav/items/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ items }),
    token,
  });
}
