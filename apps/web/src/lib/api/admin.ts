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
  /**
   * A1 — su última IP de gestión está en la lista de vigilancia.
   *
   * Lo resuelve el SERVIDOR y llega ya derivado: la lista de IPs no viaja al frontal, y el
   * backoffice no tiene por qué saber qué vigila el equipo para pintar un distintivo. La
   * lista tampoco sirve la IP en crudo — dice SI está marcada, no CUÁL es.
   *
   * Es una señal: no despublica el anuncio ni le hace nada.
   */
  ipFlagged: boolean;
  /**
   * VÍDEO #13 — «este anuncio lleva vídeo». El HECHO, nunca la dirección.
   *
   * Lo deriva el servidor de `videoUrl`, que NO viaja: la lista no monta ningún `<video>`
   * y no podría aunque alguien lo intentara. Es el mismo contrato de cero bytes que ya
   * cumplen las tarjetas públicas, sostenido desde el payload y no desde la disciplina de
   * quien pinta.
   */
  hasVideo: boolean;
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
  /**
   * PUNTO 6 · RÁFAGA A — lo que el motor encontró en el texto. El TERCER eje, ortogonal a
   * `triage` y a `watched`: son tres preguntas compatibles («¿lo han mirado?», «¿lo
   * vigilamos?», «¿qué encontró el sistema?»).
   *
   * Viaja el FRAGMENTO y no un booleano porque el moderador tiene que poder juzgarlo: una
   * IP en un anuncio de router es legítima y en uno de bicicletas no.
   */
  detections: {
    id: string;
    detector: 'WORD' | 'PHONE' | 'PHONE_LIST';
    field: 'TITLE' | 'DESCRIPTION';
    match: string;
    rule: string | null;
  }[];
  publishedAt: string | null;
  expiresAt: string | null;
  bumpedAt: string | null;
  /** ÚLTIMA IP (5b) — la última gestión de su DUEÑO. Otra pregunta que `updatedAt`. */
  lastOwnerInteractionAt: string | null;
  lastOwnerIp: string | null;
  /** A1 — esa IP está en la lista de vigilancia. Derivado por el servidor; sólo señala. */
  ipFlagged: boolean;
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
    /** 7b — si cuenta o no para la media. Retirar una que no cuenta no cambia la reputación de nadie. */
    verified: boolean;
    /** 7b — `null` = vigente. Los lectores de staff NO excluyen las retiradas: las enseñan marcadas. */
    retiredAt: string | null;
    retiredReason: string | null;
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
  /** VÍDEO #13 — «sólo los que llevan vídeo». Tres posiciones, molde de `watched`. */
  conVideo?: boolean;
  /**
   * PUNTO 6 · RÁFAGA A — el EJE PROPIO del aviso, independiente de `triage` y `watched`.
   * `hasDetections`: ¿el motor encontró algo? `detector`: ¿cuál disparó?
   * Combinarlos es lo que hace de la lista el banco de pruebas del modo avisar.
   */
  hasDetections?: boolean;
  detector?: 'WORD' | 'PHONE' | 'PHONE_LIST';
  /** A1 — «su ultima IP de gestion esta en la lista de vigilancia». Derivado, sin tabla. */
  ipFlagged?: boolean;
  /** ÚLTIMA IP (5b) — la IP desde la que su DUEÑO lo gestionó por última vez. Cruza con
   *  el filtro por IP de usuarios: «qué anuncios se han tocado desde aquí». */
  ip?: string;
  /**
   * El TELÉFONO publicado del anuncio, buscado en CUALQUIER formato: se compara la forma
   * canónica de los dos lados, así que «654 123 456» encuentra al que lo guardó como
   * «+34654123456». Parámetro propio y no dentro del buscador de texto, por lo mismo que la
   * IP: un identificador se busca entero o no se busca.
   */
  phone?: string;
  /**
   * PROVINCIA y MUNICIPIO. Parámetros propios: «anuncios DE Toledo» y «anuncios que
   * MENCIONAN Toledo» son preguntas distintas, y meterlos en el buscador de texto las
   * mezclaría sin dejar pedir sólo una.
   */
  province?: string;
  city?: string;
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
  if (params?.conVideo !== undefined) qs.set('conVideo', String(params.conVideo));
  if (params?.hasDetections !== undefined) {
    qs.set('hasDetections', String(params.hasDetections));
  }
  if (params?.detector) qs.set('detector', params.detector);
  if (params?.ipFlagged !== undefined) qs.set('ipFlagged', String(params.ipFlagged));
  if (params?.ip) qs.set('ip', params.ip);
  if (params?.phone) qs.set('phone', params.phone);
  if (params?.province) qs.set('province', params.province);
  if (params?.city) qs.set('city', params.city);
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

/**
 * P3a — el staff edita los CAMPOS de un anuncio ajeno.
 *
 * RUTA HERMANA de `changeListingStatus` y `setListingTriage`, no la misma: los
 * tres tocan ejes distintos del anuncio. Ésta **no mueve el triaje** —`EDITED`
 * afirma que editó el DUEÑO— y **no cambia el estado**, que tiene su propia vía
 * con su registro y su aviso (M2).
 *
 * `reason` es obligatorio: va al `AuditLog`, y sin él una edición de staff sería
 * indistinguible de una del dueño.
 */
export function updateAdminListing(
  token: string,
  id: string,
  cambio: {
    reason: string;
    title?: string;
    description?: string;
    price?: number;
    priceType?: string;
    priceUnit?: string;
    categoryId?: string;
    attributes?: Record<string, unknown>;
    tags?: string[];
    imageIds?: string[];
    city?: string;
    province?: string;
    postalCode?: string;
  },
): Promise<unknown> {
  return apiFetch(`/admin/listings/${id}`, {
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
  /**
   * ÚLTIMA IP (5b) — el último inicio de sesión y desde dónde. MODERATOR+, por decisión
   * escrita (`docs/diseno-ultima-ip.md` §6): dato personal, finalidad única de moderación
   * antifraude, sólo la ÚLTIMA y nunca un historial.
   *
   * NULL para quien nunca ha entrado — el dato no existía antes de 5a y no hay backfill.
   */
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  /**
   * A1 — esa IP está en la lista de vigilancia. Derivado por el servidor.
   *
   * SÓLO SEÑALA: no suspende la cuenta ni le pone `requiresReview`, que es una decisión de
   * una persona y se audita con su nombre. La máquina señala; la persona marca.
   *
   * Va en `AdminUser` y no en el detalle porque `AdminUserDetail` lo extiende: una sola
   * declaración cubre la lista y la ficha.
   */
  ipFlagged?: boolean;
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
  // BORRADO DE CUENTAS C2 — el contexto del archivado. `statusBeforeArchive` es
  // A DÓNDE volvería la cuenta si se desarchiva: la ficha lo enseña para que
  // «Desarchivar» no sea un botón que promete algo distinto de lo que hace.
  archivedAt: string | null;
  archiveReason: 'SELF_REQUEST' | 'STAFF_ACTION' | null;
  archiveNote: string | null;
  statusBeforeArchive: string | null;
  archivedBy: { id: string; name: string; slug: string } | null;
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
  /** 7b — `verified`/`retiredAt`/`retiredReason` en las dos: ver `AdminListingDetail.reviews`. */
  reviewsReceived: Array<{
    id: string;
    rating: number;
    comment: string | null;
    createdAt: string;
    verified: boolean;
    retiredAt: string | null;
    retiredReason: string | null;
    author: { id: string; name: string | null; slug: string | null };
  }>;
  reviewsAuthored: Array<{
    id: string;
    rating: number;
    comment: string | null;
    createdAt: string;
    verified: boolean;
    retiredAt: string | null;
    retiredReason: string | null;
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

/**
 * ÚLTIMA IP (5b) — `ip` y `order` son NUEVOS.
 *
 * Esta lista **no tenía eje de orden ninguno** (el backend llevaba `createdAt desc`
 * clavado). El marco de F2 se TRAE aquí; no se extiende, porque el suyo es de anuncios.
 * El orden por defecto pasa a ser la última conexión, así que no se manda cuando es ése:
 * la regla de `filtros-url.ts` —«lo que está por defecto no se escribe»— vale igual.
 */
export type AdminUsersOrder = 'last-login-desc' | 'last-login-asc' | 'recent' | 'oldest';

export function getAdminUsers(
  token: string,
  params?: {
    status?: string;
    role?: string;
    q?: string;
    ip?: string;
    /**
     * A1 — «su última conexión fue desde una IP marcada». Distinto de `ip`, que pregunta por
     * UNA concreta: esto pregunta por la lista entera, que es la forma de revisar de golpe a
     * todo el que entró desde algún sitio vigilado.
     */
    ipFlagged?: boolean;
    order?: AdminUsersOrder;
    page?: number;
  },
): Promise<PaginatedAdminUsers> {
  const qs = new URLSearchParams({ page: String(params?.page ?? 1) });
  if (params?.status) qs.set('status', params.status);
  if (params?.role) qs.set('role', params.role);
  if (params?.q) qs.set('q', params.q);
  if (params?.ip) qs.set('ip', params.ip);
  if (params?.ipFlagged !== undefined) qs.set('ipFlagged', String(params.ipFlagged));
  if (params?.order) qs.set('order', params.order);
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

/**
 * BORRADO DE CUENTAS C2 — el staff archiva una cuenta. MODERATOR+, reversible.
 * `archiveReason` NO viaja: lo fija el endpoint (`STAFF_ACTION`), para que nadie
 * pueda archivar a otro diciendo que se lo pidió.
 */
export function archiveUser(token: string, id: string, note?: string): Promise<unknown> {
  return apiFetch(`/admin/users/${id}/archive`, {
    method: 'PATCH',
    body: JSON.stringify(note ? { note } : {}),
    token,
  });
}

/**
 * Devuelve la cuenta a la vida. NO recibe destino: el backend lo lee de
 * `statusBeforeArchive`, así que un baneado archivado vuelve a BANNED. Si esta
 * función aceptara un estado, archivar sería el atajo para levantar un ban.
 */
export function unarchiveUser(token: string, id: string): Promise<unknown> {
  return apiFetch(`/admin/users/${id}/unarchive`, { method: 'PATCH', token });
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

/**
 * PUNTO 6 · RÁFAGA B — cuánto está disparando cada detector, y en qué modo está.
 *
 * SON RECUENTOS EN BRUTO, no una tasa de acierto: `listings` es a cuántos anuncios afectaría
 * ascender el detector y `detections` cuántos hallazgos hay en total. No hay ningún
 * porcentaje porque no se puede calcular sin un veredicto humano por hallazgo, que no
 * existe. Ver `docs/diseno-listas-bloqueo.md` §2.4.
 */
export interface DetectionStat {
  detector: 'WORD' | 'PHONE' | 'PHONE_LIST';
  mode: 'WARN' | 'BLOCK';
  listings: number;
  detections: number;
}

export function getDetectionStats(token: string): Promise<DetectionStat[]> {
  return apiFetch<DetectionStat[]>('/admin/detection/stats', { token });
}
