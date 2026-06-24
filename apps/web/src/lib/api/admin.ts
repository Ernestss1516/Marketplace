import { apiFetch } from './client';

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

export function banUser(token: string, id: string): Promise<unknown> {
  return apiFetch(`/admin/users/${id}/ban`, { method: 'PATCH', token });
}

export function reinstateUser(token: string, id: string): Promise<unknown> {
  return apiFetch(`/admin/users/${id}/reinstate`, { method: 'PATCH', token });
}

// ─── Categories ───────────────────────────────────────────────────────────────

export interface AdminCategoryChild {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  order: number;
  attributeSchema: unknown[];
}

export interface AdminCategory extends AdminCategoryChild {
  children: AdminCategoryChild[];
}

export interface CategoryMutationDto {
  name?: string;
  slug?: string;
  parentId?: string;
  iconUrl?: string;
  order?: number;
  attributeSchema?: unknown[];
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

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface AdminSetting {
  key: string;
  value: unknown;
  updatedAt: string;
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
