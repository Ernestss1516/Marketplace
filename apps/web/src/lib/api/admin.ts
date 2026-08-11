import { apiFetch } from './client';
import type { AttributeSchema, ListingTypePolicy, ListingViewMode, PriceUnit } from '@/types';

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface AdminStats {
  listings: {
    active: number;
    pendingReview: number;
    publishedToday: number;
  };
  users: {
    total: number;
    newToday: number;
  };
  moderation: {
    reportsPending: number;
  };
  conversations: {
    total: number;
  };
  search: {
    totalDocuments: number;
    isIndexing: boolean;
  } | null;
}

export function getAdminStats(token: string): Promise<AdminStats> {
  return apiFetch<AdminStats>('/admin/stats', { token });
}

// ─── Listings ─────────────────────────────────────────────────────────────────

export interface AdminListing {
  id: string;
  title: string;
  slug: string;
  status: string;
  price: number;
  currency: string;
  priceType: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  category: { id: string; name: string; slug: string };
  seller: { id: string; name: string; slug: string; email: string };
  images: { url: string }[];
  _count: { reports: number };
}

export interface PaginatedAdminListings {
  items: AdminListing[];
  total: number;
  page: number;
  perPage: number;
}

export function getAdminListings(
  token: string,
  params?: { status?: string; page?: number; perPage?: number },
): Promise<PaginatedAdminListings> {
  const qs = new URLSearchParams({ page: String(params?.page ?? 1) });
  if (params?.status) qs.set('status', params.status);
  if (params?.perPage) qs.set('perPage', String(params.perPage));
  return apiFetch<PaginatedAdminListings>(`/admin/listings?${qs}`, { token });
}

export function changeListingStatus(
  token: string,
  id: string,
  status: string,
  reason?: string,
): Promise<unknown> {
  return apiFetch(`/admin/listings/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
    token,
  });
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  slug: string;
  role: string;
  status: string;
  emailVerified: boolean;
  city: string | null;
  province: string | null;
  createdAt: string;
  /** H8 Bloque E — "Vendedor de confianza", independiente de Pro. */
  trusted: boolean;
  _count: { listings: number };
}

export interface PaginatedAdminUsers {
  items: AdminUser[];
  total: number;
  page: number;
  perPage: number;
}

export interface AdminUserDetail extends Omit<AdminUser, '_count'> {
  phone: string | null;
  avatarUrl: string | null;
  bio: string | null;
  postalCode: string | null;
  updatedAt: string;
  listings: Array<{
    id: string;
    title: string;
    slug: string;
    status: string;
    price: number;
    currency: string;
    priceType: string;
    publishedAt: string | null;
    createdAt: string;
  }>;
  reportsReceived: Array<{
    id: string;
    reason: string;
    status: string;
    description: string | null;
    createdAt: string;
    reporter: { id: string; name: string; slug: string } | null;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    before: unknown;
    after: unknown;
    createdAt: string;
    actor: { id: string; name: string; slug: string };
  }>;
}

export function getAdminUsers(
  token: string,
  params?: { status?: string; role?: string; q?: string; page?: number },
): Promise<PaginatedAdminUsers> {
  const qs = new URLSearchParams({ page: String(params?.page ?? 1) });
  if (params?.status) qs.set('status', params.status);
  if (params?.role) qs.set('role', params.role);
  if (params?.q) qs.set('q', params.q);
  return apiFetch<PaginatedAdminUsers>(`/admin/users?${qs}`, { token });
}

export function getAdminUser(token: string, id: string): Promise<AdminUserDetail> {
  return apiFetch<AdminUserDetail>(`/admin/users/${id}`, { token });
}

export function suspendUser(token: string, id: string): Promise<unknown> {
  return apiFetch(`/admin/users/${id}/suspend`, { method: 'PATCH', token });
}

// Reverses a SUSPENSION (MODERATOR+ADMIN). Only valid if user is SUSPENDED.
export function unsuspendUser(token: string, id: string): Promise<unknown> {
  return apiFetch(`/admin/users/${id}/unsuspend`, { method: 'PATCH', token });
}

// Permanent ban — ADMIN-only.
export function banUser(token: string, id: string): Promise<unknown> {
  return apiFetch(`/admin/users/${id}/ban`, { method: 'PATCH', token });
}

// Reverses a BAN (ADMIN-only).
export function reinstateUser(token: string, id: string): Promise<unknown> {
  return apiFetch(`/admin/users/${id}/reinstate`, { method: 'PATCH', token });
}

// H8 Bloque E — "Vendedor de confianza" (ADMIN-only).
export function setUserTrusted(token: string, id: string, trusted: boolean): Promise<unknown> {
  return apiFetch(`/admin/users/${id}/trusted`, {
    method: 'PATCH',
    body: JSON.stringify({ trusted }),
    token,
  });
}

// Cambio de rol — ADMIN-only. El DTO acepta USER|MODERATOR|EDITOR como destino
// (ADMIN excluido); el service rechaza además cualquier intento sobre un target ADMIN.
export function changeUserRole(token: string, id: string, role: string): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${id}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
    token,
  });
}

// ─── Categories ───────────────────────────────────────────────────────────────

export type { AttributeSchema as AttributeField };

export interface AdminCategoryChild {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  order: number;
  attributeSchema: AttributeSchema[];
  allowedListingType: ListingTypePolicy;
  /** RÁFAGA 2 — valores PROPIOS (no resueltos): [] = "no configurado". */
  allowedViews: ListingViewMode[];
  defaultView: ListingViewMode | null;
  /** RP.2 — también PROPIO, no el efectivo: el admin edita lo que esta categoría
   *  configura, no lo que hereda. [] = "no configurado". */
  allowedPriceUnits: PriceUnit[];
}

/**
 * PROFUNDIDAD N — RÁFAGA 2: el tipo es RECURSIVO. Antes un hijo no podía tener
 * hijos (`children: AdminCategoryChild[]`), que era el árbol de 2 niveles
 * escrito en el tipo. `GET /admin/categories` ya devuelve el árbol completo.
 */
export interface AdminCategory extends AdminCategoryChild {
  children: AdminCategory[];
}

export interface CategoryMutationDto {
  name?: string;
  slug?: string;
  parentId?: string;
  iconUrl?: string;
  order?: number;
  attributeSchema?: unknown[];
  allowedListingType?: ListingTypePolicy;
  allowedViews?: ListingViewMode[];
  defaultView?: ListingViewMode;
  allowedPriceUnits?: PriceUnit[];
}

export function getSearchableKeys(token: string): Promise<{ keys: string[] }> {
  return apiFetch<{ keys: string[] }>('/admin/categories/searchable-keys', { token });
}

export function getAdminCategories(token: string): Promise<AdminCategory[]> {
  return apiFetch<AdminCategory[]>('/admin/categories', { token });
}

export function createAdminCategory(
  token: string,
  dto: Required<Pick<CategoryMutationDto, 'name' | 'slug'>> & Omit<CategoryMutationDto, 'name' | 'slug'>,
): Promise<AdminCategoryChild> {
  return apiFetch<AdminCategoryChild>('/admin/categories', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}

export function updateAdminCategory(
  token: string,
  id: string,
  dto: CategoryMutationDto,
): Promise<AdminCategoryChild> {
  return apiFetch<AdminCategoryChild>(`/admin/categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
    token,
  });
}

export function reorderAdminCategories(
  token: string,
  items: { id: string; order: number }[],
): Promise<void> {
  return apiFetch('/admin/categories/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ items }),
    token,
  });
}

export function deleteAdminCategory(token: string, id: string): Promise<void> {
  return apiFetch(`/admin/categories/${id}`, { method: 'DELETE', token });
}

// Cuenta cuántos anuncios de la categoría tienen datos bajo `key` en su
// attributes JSON. Usado para avisar antes de renombrar una key con datos.
export function getCategoryAttributeUsage(
  token: string,
  categoryId: string,
  key: string,
): Promise<{ count: number }> {
  const qs = new URLSearchParams({ key });
  return apiFetch<{ count: number }>(`/admin/categories/${categoryId}/attribute-usage?${qs}`, {
    token,
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface AdminSetting {
  key: string;
  value: unknown;
  /** null cuando la clave todavía no tiene fila: nunca se ha guardado. */
  updatedAt: string | null;
  /**
   * false = no hay fila en la base y `value` es el DEFAULT que usa el backend.
   * El primer guardado crea la fila (PATCH → upsert).
   */
  configured?: boolean;
}

export function getAdminSettings(token: string): Promise<AdminSetting[]> {
  return apiFetch<AdminSetting[]>('/admin/settings', { token });
}

export function updateAdminSetting(
  token: string,
  key: string,
  value: unknown,
): Promise<AdminSetting> {
  return apiFetch<AdminSetting>(`/admin/settings/${key}`, {
    method: 'PATCH',
    body: JSON.stringify({ value }),
    token,
  });
}
