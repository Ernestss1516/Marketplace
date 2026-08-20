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
  /** ETIQUETA INTERNA (P1) — el triaje del staff. Eje independiente de `status`. */
  triage: string;
  /** ETIQUETA INTERNA (P1) — «el staff lo vigila». Ortogonal al triaje. */
  watched: boolean;
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

/**
 * FICHA F1 (P4) — el detalle que pinta `/admin/anuncios/{id}`.
 *
 * El endpoint existía, estaba protegido con MODERATOR y **no lo llamaba nadie**:
 * este cliente tenía listar, cambiar estado y eliminar, y ninguna función para
 * el detalle. Ésta es esa función.
 */
export interface AdminListingDetail {
  id: string;
  title: string;
  slug: string;
  description: string;
  status: string;
  price: number;
  currency: string;
  type: string;
  condition: string | null;
  priceType: string;
  priceUnit: string;
  attributes: Record<string, unknown>;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
  viewCount: number;
  videoUrl: string | null;
  videoPosterUrl: string | null;
  videoDurationSeconds: number | null;
  videoUploadedAt: string | null;
  needsRevalidation: boolean;
  /** ETIQUETA INTERNA (P1) — el triaje del staff. NO es el estado del anuncio. */
  triage: string;
  /** ETIQUETA INTERNA (P1) — «el staff lo vigila». Ortogonal al triaje. */
  watched: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  bumpedAt: string | null;
  createdAt: string;
  updatedAt: string;
  category: { id: string; name: string; slug: string; attributeSchema: AttributeSchema[] };
  /** La cadena de ancestros: «Motor › Coches › Berlinas», no «Berlinas». */
  categoryPath: { id: string; name: string; slug: string }[];
  seller: {
    id: string;
    name: string | null;
    email: string;
    slug: string | null;
    status: string;
    role: string;
    createdAt: string;
    trusted: boolean;
    requiresReview: boolean;
  };
  images: { id: string; url: string; alt: string | null }[];
  reports: {
    id: string;
    reason: string;
    status: string;
    createdAt: string;
    reporter: { id: string; name: string | null; slug: string | null } | null;
  }[];
  reviews: {
    id: string;
    rating: number;
    comment: string | null;
    createdAt: string;
    author: { id: string; name: string | null; slug: string | null };
  }[];
  tickets: { id: string; subject: string; status: string; createdAt: string }[];
  deals: {
    id: string;
    createdAt: string;
    buyer: { id: string; name: string | null; slug: string | null };
  }[];
  bumpSchedule: {
    id: string;
    status: string;
    intervalDays: number;
    hourOfDay: number;
    nextRunAt: string;
    lastRunAt: string | null;
  } | null;
  _count: {
    conversations: number;
    reports: number;
    reviews: number;
    tickets: number;
    deals: number;
    favorites: number;
    viewsDaily: number;
  };
  /**
   * Lo que está encendido AHORA — no el motivo por el que el anuncio entró en la
   * cola, que no se persiste en ningún sitio. La ficha lo dice con esas palabras.
   */
  moderationSignals: {
    usuario: boolean;
    categoria: boolean;
    plataforma: boolean;
    palabraProhibida: boolean;
  };
  historial: {
    id: string;
    action: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    createdAt: string;
    actor: { id: string; name: string | null; slug: string | null } | null;
  }[];
}

export function getAdminListing(token: string, id: string): Promise<AdminListingDetail> {
  return apiFetch<AdminListingDetail>(`/admin/listings/${id}`, { token });
}

/**
 * FICHA F2 (P6) — los ejes con los que el backoffice encuentra un anuncio.
 *
 * `status` y `order` conservan su significado EXACTO: la cola de revisión (M3)
 * llama con `status=PENDING_REVIEW&order=oldest` y no puede notar F2.
 *
 * Los cinco ejes que el diseño dejó para después —precio, provincia, tipo,
 * condición, vídeo— y el filtro por etiqueta interna (P1) entran añadiendo un
 * campo aquí y una línea en el `where` del backend. La forma no cambia.
 */
export type AdminListingsOrder =
  | 'recent'
  | 'oldest'
  | 'created-desc'
  | 'created-asc'
  | 'price-desc'
  | 'price-asc'
  | 'reports-desc';

export interface AdminListingsFilters {
  /** Texto libre: título, descripción, slug o id pegado. */
  q?: string;
  /** Estado único — el que usa la cola de M3. */
  status?: string;
  /** Varios estados a la vez; si viene, gana sobre `status`. */
  statuses?: string[];
  /** Incluye SIEMPRE los descendientes de la categoría, a cualquier profundidad. */
  categoryId?: string;
  sellerId?: string;
  hasReports?: boolean;
  needsRevalidation?: boolean;
  /** ETIQUETA INTERNA (P1, E2) — triaje múltiple; molde de `statuses`. */
  triage?: string[];
  /** ETIQUETA INTERNA (P1, E2) — tres posiciones; molde de `hasReports`. */
  watched?: boolean;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  order?: AdminListingsOrder;
  page?: number;
  perPage?: number;
}

export function getAdminListings(
  token: string,
  params?: AdminListingsFilters,
): Promise<PaginatedAdminListings> {
  const qs = new URLSearchParams({ page: String(params?.page ?? 1) });
  if (params?.q) qs.set('q', params.q);
  if (params?.status) qs.set('status', params.status);
  if (params?.statuses?.length) qs.set('statuses', params.statuses.join(','));
  if (params?.categoryId) qs.set('categoryId', params.categoryId);
  if (params?.sellerId) qs.set('sellerId', params.sellerId);
  if (params?.hasReports !== undefined) qs.set('hasReports', String(params.hasReports));
  if (params?.needsRevalidation !== undefined) {
    qs.set('needsRevalidation', String(params.needsRevalidation));
  }
  if (params?.triage?.length) qs.set('triage', params.triage.join(','));
  if (params?.watched !== undefined) qs.set('watched', String(params.watched));
  if (params?.createdFrom) qs.set('createdFrom', params.createdFrom);
  if (params?.createdTo) qs.set('createdTo', params.createdTo);
  if (params?.updatedFrom) qs.set('updatedFrom', params.updatedFrom);
  if (params?.updatedTo) qs.set('updatedTo', params.updatedTo);
  if (params?.perPage) qs.set('perPage', String(params.perPage));
  // MODERACIÓN M3 — la cola pide `oldest` (lo que lleva más esperando, primero).
  // Sin el parámetro, el orden es el de siempre.
  if (params?.order) qs.set('order', params.order);
  return apiFetch<PaginatedAdminListings>(`/admin/listings?${qs}`, { token });
}

/**
 * ETIQUETA INTERNA (P1) — el cambio MANUAL del triaje y de la observación.
 *
 * RUTA HERMANA de `changeListingStatus`, no la misma: anotar el triaje y cambiar
 * el estado son cosas distintas sobre ejes distintos, y compartir función
 * invitaría a mezclarlas.
 *
 * `triage` sólo admite `NEW` o `REVIEWED`: `EDITED` afirma un hecho que sólo el
 * sistema puede saber, y el backend lo rechaza con 400. Omitir un campo NO lo
 * pisa — los dos ejes se editan juntos y se guardan por separado.
 */
export function setListingTriage(
  token: string,
  id: string,
  cambio: { triage?: string; watched?: boolean },
): Promise<{ id: string; triage: string; watched: boolean }> {
  return apiFetch(`/admin/listings/${id}/triage`, {
    method: 'PATCH',
    body: JSON.stringify(cambio),
    token,
  });
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

/**
 * BORRADO B2 — LA ÚNICA VÍA QUE DESTRUYE UN ANUNCIO. ADMIN-only, y el backend
 * sólo la admite sobre `ARCHIVED`: para eliminar algo vivo hay que archivarlo
 * primero, en dos pasos deliberados.
 */
export function deleteAdminListing(token: string, id: string): Promise<void> {
  return apiFetch(`/admin/listings/${id}`, { method: 'DELETE', token });
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
  /** MODERACIÓN M4 — sus anuncios pasan por revisión previa. Eje INDEPENDIENTE
   *  de `trusted`: se puede estar marcado y ser de confianza a la vez. */
  requiresReview?: boolean;
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
  /**
   * FICHA DE USUARIO U3 — el HECHO de ser Pro, y sólo el hecho.
   *
   * Se sirve a MODERATOR porque es información PÚBLICA (la insignia Pro está en
   * el perfil de cualquier vendedor). La procedencia, el vencimiento y el saldo
   * NO están aquí: describen una relación comercial y viven en el detalle de
   * facturación, que es ADMIN. Ver D-3.
   */
  isPro: boolean;
  /** Los reportes que ESTE usuario ha hecho — el otro lado de `reportsReceived`. */
  reportsMade: Array<{
    id: string;
    reason: string;
    status: string;
    createdAt: string;
    listingId: string | null;
    reportedUserId: string | null;
  }>;
  reviewsReceived: Array<{
    id: string;
    rating: number;
    comment: string | null;
    createdAt: string;
    author: { id: string; name: string | null; slug: string | null };
  }>;
  reviewsAuthored: Array<{
    id: string;
    rating: number;
    comment: string | null;
    createdAt: string;
    target: { id: string; name: string | null; slug: string | null };
  }>;
  tickets: Array<{ id: string; subject: string; status: string; createdAt: string }>;
  _count: {
    listings: number;
    reviewsReceived: number;
    reportsMade: number;
    tickets: number;
  };
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

/**
 * MODERACIÓN M4 — marca a un vendedor para que sus anuncios pasen por revisión.
 * ADMIN-only, molde de `setUserTrusted`.
 *
 * NO es lo contrario de la confianza: son ejes independientes. Un vendedor puede
 * estar marcado y ser de confianza a la vez, y en ese caso se revisa.
 */
export function setUserRequiresReview(
  token: string,
  id: string,
  requiresReview: boolean,
): Promise<unknown> {
  return apiFetch(`/admin/users/${id}/requires-review`, {
    method: 'PATCH',
    body: JSON.stringify({ requiresReview }),
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
  /**
   * MODERACIÓN M1/M5 — los anuncios de esta categoría pasan por revisión previa.
   * También es el valor PROPIO, pero a diferencia de los demás su herencia es
   * MONÓTONA, no override: si CUALQUIER ancestro lo tiene a `true`, esta
   * categoría se revisa aunque el suyo sea `false`, y no hay forma de aflojarlo
   * desde aquí. El panel pliega la cadena para no enseñar un `false` que miente.
   */
  requiresReview: boolean;
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
  /** MODERACIÓN M1/M5 — el DTO del backend ya lo aceptaba (create y update); lo
   *  que faltaba era que el cliente pudiera mandarlo. */
  requiresReview?: boolean;
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
