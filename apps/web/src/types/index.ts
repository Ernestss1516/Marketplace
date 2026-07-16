import type { Block } from './blocks';

// Enums — mirror the Prisma schema
export type PriceType = 'FIXED' | 'FREE' | 'NEGOTIABLE';

export type ListingStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'ACTIVE'
  | 'RESERVED'
  | 'SOLD'
  | 'EXPIRED'
  | 'REJECTED'
  | 'PAUSED'
  | 'ARCHIVED';

export type ListingType = 'PRODUCT' | 'SERVICE';

export type ListingTypePolicy = 'PRODUCT_ONLY' | 'SERVICE_ONLY' | 'BOTH';

/** Vistas de resultados en /busqueda y /[categoria] (RÁFAGA 2). */
export type ListingViewMode = 'LISTA' | 'AMPLIADA' | 'MAPA';

export type Condition = 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'FOR_PARTS';

export type Role = 'USER' | 'MODERATOR' | 'ADMIN';

// ── Users ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  slug: string;
  phone?: string;
  avatarUrl?: string;
  bio?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  role: Role;
  emailVerified: boolean;
}

export interface UserPublic {
  name: string;
  slug: string;
  avatarUrl?: string;
  bio?: string;
  city?: string;
  province?: string;
  memberSince: string;
  /** H8.4 — true when the seller has an active Pro subscription. */
  isPro: boolean;
  /** H8 Bloque E — "Vendedor de confianza", granted by an admin. Independent of isPro. */
  trusted: boolean;
}

// ── Categories ───────────────────────────────────────────────────────────────

export interface AttributeSchema {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  unit?: string;
  options?: string[];
  filterable: boolean;
  required: boolean;
  cardAttribute?: boolean;
  /** Shown in the wide/ampliada card (RÁFAGA 2 — max 6 in the effective schema). Independent of `cardAttribute`. */
  wideCardAttribute?: boolean;
  /** RÁFAGA 3 — dos ejes independientes de cómo se muestra el atributo en card (no un enum de 3
   * modos: la unidad es parte del valor formateado, no alternativa al nombre). Ausente = default
   * calculado a partir de `unit` (ver resolveShowLabel/resolveShowUnit en el backend). */
  showLabel?: boolean;
  showUnit?: boolean;
  /** Which listing type(s) this attribute applies to. Absent = applies to both. */
  appliesTo?: ListingType[];
  /** Name of another `select` attribute whose value gates this field's valid options. Single level only (no chains). When set, `options` is ignored. */
  dependsOn?: string;
  /** Valid options for this field, keyed by the current value of `dependsOn`'s field. Only meaningful when `dependsOn` is set. */
  optionsByParent?: Record<string, string[]>;
}

export interface CardAttributeDef {
  key: string;
  label: string;
  unit?: string;
  /** RÁFAGA 3 — ya resueltos por el backend (categories.service.ts): siempre presentes aquí,
   * nunca "ausente = calcular default" en el frontend. */
  showLabel: boolean;
  showUnit: boolean;
  /** ATRIBUTOS EN CARD — respetar producto/servicio. Qué tipo(s) de anuncio muestran este
   * atributo en card. Ausente = aplica a ambos (mismo default que AttributeSchema.appliesTo). */
  appliesTo?: ListingType[];
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  iconUrl?: string;
  cardAttributes?: CardAttributeDef[];
  /** Hasta 6 atributos para la vista ampliada (RÁFAGA 2) — independiente de cardAttributes. */
  wideCardAttributes?: CardAttributeDef[];
  /** Full attribute list (all fields, not just card-highlighted ones). Populated by GET /categories tree. */
  allAttributes?: CardAttributeDef[];
  children?: Category[];
}

export interface CategoryWithSchema extends Category {
  attributeSchema: AttributeSchema[];
  /** Política efectiva (propia + heredada del padre) — RÁFAGA 3 (wizard). */
  allowedListingType: ListingTypePolicy;
  /** Vistas efectivas (propias o heredadas del padre, o default global) — RÁFAGA 2. */
  allowedViews: ListingViewMode[];
  defaultView: ListingViewMode;
}

// ── Sponsored ads (H6.6) ─────────────────────────────────────────────────────

/** Anuncio publicitario externo intercalado en /busqueda (página 1). No es un Listing. */
export interface SponsoredAdHit {
  __sponsored: true;
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  targetUrl: string;
}

// ── Listings ─────────────────────────────────────────────────────────────────

export interface ListingSummary {
  id: string;
  title: string;
  slug: string;
  price: number;
  currency: string;
  priceType: PriceType;
  thumbnailUrl?: string;
  /** Ordered URLs of every photo (RÁFAGA 2 — carrusel en la card). Present on Meilisearch
   * hits after reindex; absent on the Postgres fallback path (thumbnailUrl still works there). */
  images?: string[];
  city?: string;
  province?: string;
  status: ListingStatus;
  publishedAt?: string;
  expiresAt?: string;
  bumpedAt?: string;
  featuredUntil?: string | null;
  categorySlug?: string;
  attributes?: Record<string, unknown>;
  /** ATRIBUTOS EN CARD — respetar producto/servicio: presente en hits de Meilisearch (ya
   * indexado en toDocument()) y en el fallback a Postgres (SELECT_SUMMARY) — necesario para
   * que la card filtre qué atributos mostrar según el tipo de ESTE anuncio concreto. */
  type?: ListingType;
  /** Present on Meilisearch hits. Enables map panel to show a description preview. */
  description?: string;
  /** Public seller fields. Present on Meilisearch hits after H6.5c re-index. */
  sellerName?: string;
  sellerSlug?: string;
  sellerAvatarUrl?: string | null;
  /** 1 when the listing has an active boost (paid feature). Only present on Meilisearch hits. */
  boostScore?: 0 | 1;
  /** Geo-coordinates from Meilisearch. Only present on hits with latitude/longitude set. */
  _geo?: { lat: number; lng: number };
  /** H8 Bloque C2 — cifras básicas. Solo presentes en /users/me/listings (mis anuncios). */
  viewCount?: number;
  favoritesCount?: number;
}

/** H8 Bloque D fase 2 — coste de bump ya con descuento de campaña aplicado, si lo hay. */
export interface BumpPricing {
  bumpCreditCost: number;
  bumpOriginalCreditCost?: number;
  bumpDiscountPercent?: number;
  /** Monetización ráfaga 2 — saldo de bumps gratis del usuario (moneda separada, por cupón). */
  bumpBalance: number;
  /** Monetización ráfaga 3 — cuota mensual de bumps gratis de Pro (distinta del saldo por cupón). */
  bumpQuota: { limit: number; used: number; remaining: number };
}

export interface ListingImage {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface Listing {
  id: string;
  title: string;
  slug: string;
  description: string;
  price: number;
  currency: string;
  priceType: PriceType;
  type: ListingType;
  condition?: Condition;
  status: ListingStatus;
  attributes: Record<string, unknown>;
  city?: string;
  province?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  images: ListingImage[];
  category: Pick<Category, 'name' | 'slug'>;
  seller: Pick<UserPublic, 'name' | 'slug' | 'avatarUrl' | 'trusted'>;
  publishedAt?: string;
  viewCount: number;
  featuredUntil?: string | null;
  /** true cuando el anuncio tiene teléfono publicado — el número en sí nunca viaja aquí (ver GET /listings/:id/phone). */
  hasPhone: boolean;
}

// ── H8 Bloque C — estadísticas de anuncios ──────────────────────────────────

/** GET /listings/mine/:id/stats — enriquecido con dailyViews/likeRatio solo si el dueño es Pro. */
export interface ListingStats {
  viewCount: number;
  favoritesCount: number;
  dailyViews?: { date: string; count: number }[];
  likeRatio?: number;
}

/** GET /listings/mine/stats/summary — solo Pro (403 si no). */
export interface ListingStatsSummary {
  totalViews: number;
  totalFavorites: number;
  mostViewedListingId: string | null;
}

// ── Shared ───────────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string;
  error?: string;
}

// ── Publicar anuncio ──────────────────────────────────────────────────────────

export interface CreateListingPayload {
  title: string;
  description: string;
  price: number;
  currency?: string;
  priceType: PriceType;
  type: ListingType;
  condition?: Condition;
  categoryId: string;
  attributes?: Record<string, unknown>;
  city: string;
  province: string;
  postalCode?: string;
  /** Teléfono a PUBLICAR en este anuncio (opcional, distinto del teléfono del perfil). */
  phone?: string;
  imageIds?: string[];
}

export interface CreatedListing {
  id: string;
  slug: string;
  status: 'DRAFT';
}

export interface MediaUploadResponse {
  id: string;
  url: string;
  width?: number;
  height?: number;
}

// ── Edición de anuncio ────────────────────────────────────────────────────────

export interface UpdateListingPayload {
  title?: string;
  description?: string;
  price?: number;
  currency?: string;
  priceType?: PriceType;
  // type deliberately omitted — immutable after creation (RÁFAGA 1, producto/servicio).
  condition?: Condition;
  categoryId?: string;
  attributes?: Record<string, unknown>;
  city?: string;
  province?: string;
  postalCode?: string;
  /** Vacío ('') deja de publicar teléfono en este anuncio (mismo convenio que postalCode). */
  phone?: string;
  imageIds?: string[];
}

export interface MyListingImage {
  id: string;
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface MyListing {
  id: string;
  title: string;
  slug: string;
  description: string;
  price: number;
  currency: string;
  priceType: PriceType;
  type: ListingType;
  condition?: Condition;
  status: ListingStatus;
  attributes: Record<string, unknown>;
  city?: string;
  province?: string;
  postalCode?: string;
  phone?: string;
  images: MyListingImage[];
  category: { id: string; name: string; slug: string };
  publishedAt?: string;
}

// ── Ciclo de vida RÁFAGA 1 — Deal (cierre de trato) ────────────────────────────

/** Persona mínima para elegir comprador/cliente — contactos del anuncio o resultado de búsqueda. */
export interface PersonStub {
  id: string;
  name: string;
  slug: string;
  avatarUrl?: string;
}

/** Contacto de un anuncio — alguien con conversación abierta sobre él. */
export interface ListingContact extends PersonStub {
  lastMessageAt: string;
}

export interface Deal {
  id: string;
  listingId: string | null;
  listingTitle: string;
  sellerId: string;
  buyerId: string;
  buyer: PersonStub;
  conversationId: string | null;
  createdAt: string;
}

export interface CloseDealResult {
  listing: { id: string; status: ListingStatus };
  deal: Deal | null;
}

// ── Favorites ────────────────────────────────────────────────────────────────

// Omits the base `images?: string[]` (Meilisearch carousel URLs, RÁFAGA 2): the favorites
// API (Postgres) returns full ListingImage-like objects under the same JSON key, an
// incompatible shape. `normalize()` in lib/api/favoritos.ts reads this to derive
// `thumbnailUrl` and does NOT carry it over into the ListingSummary-typed result.
export interface FavoriteListingData extends Omit<ListingSummary, 'images'> {
  images: { url: string }[];
  /** Raw nested relation returned by the favorites API (used in normalize() to extract categorySlug). */
  category?: { slug: string };
}

export interface FavoriteItem {
  id: string;
  listingId: string;
  createdAt: string;
  listing: FavoriteListingData;
}

export interface FavoritesResponse {
  items: FavoriteItem[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

// ── Reviews ───────────────────────────────────────────────────────────────────

export interface ReviewAuthor {
  name: string;
  slug: string;
  avatarUrl?: string;
}

export interface Review {
  id: string;
  rating: number;
  comment?: string | null;
  createdAt: string;
  editedAt: string | null;
  author: ReviewAuthor;
  // listingId es null cuando el anuncio original fue borrado; listingTitle
  // conserva el título como snapshot para dar contexto igualmente.
  listingId: string | null;
  listingTitle: string | null;
}

export interface ReviewsPageResponse {
  average: number | null;
  count: number;
  distribution: Record<string, number>;
  items: Review[];
  nextCursor: string | null;
}

// ── Blog ─────────────────────────────────────────────────────────────────────

export interface PostSummary {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  coverUrl: string | null;
  publishedAt: string;
  updatedAt: string;
  tags: string[];
  author: { name: string };
}

export interface Post extends PostSummary {
  blocks: Block[];
  metaTitle: string | null;
  metaDescription: string | null;
}

// ── Notifications ────────────────────────────────────────────────────────────

export type NotificationType = 'ALERT_MATCH' | 'CONTACT_MESSAGE';

/** Self-contained snapshot — mirrors AlertMatchData in the backend. */
export interface AlertMatchData {
  alertId: string;
  alertName: string;
  listingId: string;
  listingSlug: string;
  listingTitle: string;
}

/** Self-contained snapshot — mirrors ContactMessageData in the backend (RC.1). */
export interface ContactMessageData {
  messageId: string;
  motivo: string;
  email: string;
  extracto: string;
}

interface NotificationBase {
  id: string;
  userId: string;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export type NotificationItem =
  | (NotificationBase & { type: 'ALERT_MATCH'; data: AlertMatchData })
  | (NotificationBase & { type: 'CONTACT_MESSAGE'; data: ContactMessageData });

export interface NotificationsResponse {
  items: NotificationItem[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

// ── Alerts ───────────────────────────────────────────────────────────────────

export interface Alert {
  id: string;
  userId: string;
  name: string;
  q: string | null;
  categorySlug: string | null;
  type: ListingType | null;
  condition: Condition | null;
  priceType: PriceType | null;
  /** Prisma Decimal serializes as a numeric string over JSON. */
  minPrice: string | null;
  maxPrice: string | null;
  province: string | null;
  city: string | null;
  attributes: Record<string, string | number | boolean> | null;
  lat: number | null;
  lng: number | null;
  radiusMeters: number | null;
  active: boolean;
  createdAt: string;
}

export interface AlertsResponse {
  items: Alert[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

/** Criteria payload for POST/PATCH /alerts — `radius` stays in km (API boundary unit). */
export interface AlertCriteria {
  q?: string;
  categorySlug?: string;
  type?: ListingType;
  condition?: Condition;
  priceType?: PriceType;
  minPrice?: number;
  maxPrice?: number;
  province?: string;
  city?: string;
  attributes?: Record<string, string>;
  lat?: number;
  lng?: number;
  radius?: number;
}
