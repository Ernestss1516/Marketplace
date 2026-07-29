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

/** Formato del precio de un anuncio (RP.1). Eje ORTOGONAL a PriceType: un precio
 *  puede ser a la vez NEGOTIABLE y PER_MONTH. */
export type PriceUnit =
  | 'ONE_TIME'
  | 'PER_MONTH'
  | 'PER_WEEK'
  | 'PER_DAY'
  | 'PER_HOUR'
  | 'PER_UNIT'
  | 'PER_SESSION';

export type Condition = 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'FOR_PARTS';

export type Role = 'USER' | 'MODERATOR' | 'ADMIN';

/** RF.13 — tipo fiscal del receptor de facturas. Mirror del enum de Prisma. */
export type FiscalEntityType = 'INDIVIDUAL' | 'SELF_EMPLOYED' | 'COMPANY';

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
  // Datos fiscales (RF.13) — para facturación. Opcionales hasta que el usuario
  // los rellene en /perfil/facturacion.
  fiscalTaxId?: string;
  fiscalName?: string;
  fiscalEntityType?: FiscalEntityType;
  fiscalAddress?: string;
  fiscalCity?: string;
  fiscalPostalCode?: string;
  fiscalProvince?: string;
  fiscalCountry?: string;
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
  /** Formatos de precio EFECTIVOS (propios, heredados del padre, o el default
   *  global [ONE_TIME]) — RP.1 los resuelve en findBySlug. El wizard solo ofrece
   *  estos; con uno solo no pregunta nada. */
  allowedPriceUnits: PriceUnit[];
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
  /** RP.4 — formato del precio. Opcional: los hits de Meilisearch anteriores al
   *  reindex de esta ráfaga no lo traen, y `formatListingPrice` cae a ONE_TIME
   *  (sufijo vacío), que es exactamente como se venían mostrando. */
  priceUnit?: PriceUnit;
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
  /** Escaparate RÁFAGA 4 — presente en todos los orígenes de listado (Meilisearch y Postgres),
   * solo para que el backend pueda enriquecer con la media en lote; no se usa para nada más
   * en el frontend directamente. */
  sellerId?: string;
  /** Escaparate RÁFAGA 4 — media VERIFICADA del vendedor (misma fuente que el perfil). null =
   * sin valoraciones verificadas → mostrar "Nuevo", nunca ★0,0. */
  sellerRatingAverage?: number | null;
  sellerRatingCount?: number;
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
  /** RP.4 — formato del precio, mostrado como sufijo en la ficha. */
  priceUnit?: PriceUnit;
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
  seller: Pick<UserPublic, 'name' | 'slug' | 'avatarUrl' | 'trusted'> & {
    /** Escaparate RÁFAGA 4 — media VERIFICADA, siempre fresca (nunca dentro de la caché
     * de 5 min de la ficha). null = sin valoraciones verificadas → "Nuevo". */
    ratingAverage: number | null;
    ratingCount: number;
  };
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
  /** RP.3 — opcional: omitirlo deja que el backend aplique ONE_TIME (default de
   *  la columna). Debe estar entre los formatos que la categoría permite; si no,
   *  el backend responde 422 (validatePriceUnitAllowed, RP.1). */
  priceUnit?: PriceUnit;
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
  /** RP.3 — mutable (a diferencia de `type`): solo reetiqueta el mismo importe. */
  priceUnit?: PriceUnit;
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
  /** RP.3 — el wizard de edición lo usa para preseleccionar el formato actual. */
  priceUnit: PriceUnit;
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
  /** Reputación RÁFAGA 3 — congelado al crear (ver Review.verified en el backend).
   * true = cuenta para average/count/distribution; false = solo aparece en la lista. */
  verified: boolean;
}

export interface ReviewsPageResponse {
  average: number | null;
  count: number;
  distribution: Record<string, number>;
  /** Reputación RÁFAGA 3 — reseñas no verificadas para este usuario, fuera de
   * average/count/distribution pero presentes en `items`. */
  unverifiedCount: number;
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

export type NotificationType = 'ALERT_MATCH' | 'CONTACT_MESSAGE' | 'REVIEW_REQUEST';

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

/** Self-contained snapshot — mirrors ReviewRequestData in the backend (Reputación RÁFAGA 3). */
export interface ReviewRequestData {
  dealId: string;
  listingId: string | null;
  listingTitle: string;
  otherUserId: string;
  otherUserName: string;
  otherUserSlug: string;
}

/** Self-contained snapshot — mirrors InvoicingPendingFiscalDataData en el backend (RF.13 R4). */
export interface InvoicingPendingFiscalDataData {
  periodKey: string;
  facturableCount: number;
}

// ── Atención al usuario R4 ───────────────────────────────────────────────────
// Espejo de notification.types.ts del backend. `extracto` viene acotado a 140
// caracteres desde el servidor: el aviso NO transporta la conversación.

export interface TicketMessageData {
  ticketId: string;
  subject: string;
  extracto: string;
  status: string;
}

export interface TicketOpenedData {
  ticketId: string;
  subject: string;
  extracto: string;
}

export interface TicketStaffNewData {
  ticketId: string;
  subject: string;
  extracto: string;
  userName: string;
  topic: string | null;
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
  | (NotificationBase & { type: 'CONTACT_MESSAGE'; data: ContactMessageData })
  | (NotificationBase & { type: 'REVIEW_REQUEST'; data: ReviewRequestData })
  | (NotificationBase & {
      type: 'INVOICING_PENDING_FISCAL_DATA';
      data: InvoicingPendingFiscalDataData;
    })
  | (NotificationBase & { type: 'TICKET_MESSAGE'; data: TicketMessageData })
  | (NotificationBase & { type: 'TICKET_OPENED'; data: TicketOpenedData })
  | (NotificationBase & { type: 'TICKET_STAFF_NEW'; data: TicketStaffNewData });

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

// ── Tickets — atención al usuario (R6) ───────────────────────────────────────

/** Espejo de TicketStatus (Prisma). CLOSED es IRREVERSIBLE. */
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_USER' | 'RESOLVED' | 'CLOSED';

/** Quién originó el hilo. Solo un `USER` puede cerrarlo el propio usuario (T11). */
export type TicketOrigin = 'USER' | 'ADMIN' | 'REPORT';

/** Lado del mensaje, CONGELADO al escribir por el backend — no se deriva del rol. */
export type TicketAuthorSide = 'USER' | 'STAFF';

export interface TicketTopic {
  id: string;
  nombre: string;
}

/**
 * Mensaje del hilo. `internal` viene siempre `false` en la vista de usuario: el
 * backend filtra las notas internas en la propia query (getForUser). La UI
 * tampoco las espera — no hay rama que las pinte.
 */
export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string;
  side: TicketAuthorSide;
  body: string;
  internal: boolean;
  readByUserAt: string | null;
  readByStaffAt: string | null;
  createdAt: string;
}

/** Fila de la lista "mis tickets" — el resumen que sirve GET /tickets. */
export interface TicketListItem {
  id: string;
  subject: string;
  status: TicketStatus;
  origin: TicketOrigin;
  topic: TicketTopic | null;
  linkedLabel: string | null;
  lastMessageAt: string;
  createdAt: string;
  /** Mensajes del staff que el usuario aún no ha abierto. Nunca cuenta notas internas. */
  unreadCount: number;
}

export interface TicketsResponse {
  items: TicketListItem[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

/** Detalle del hilo — GET /tickets/:id (mensajes DESC + cursor). */
export interface TicketDetail {
  id: string;
  subject: string;
  status: TicketStatus;
  origin: TicketOrigin;
  topic: TicketTopic | null;
  linkedLabel: string | null;
  listingId: string | null;
  reviewId: string | null;
  invoiceId: string | null;
  listing: { id: string; title: string; slug: string } | null;
  review: { id: string; rating: number } | null;
  invoice: { id: string; number: string | null; status: string } | null;
  lastMessageAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  messages: TicketMessage[];
  nextCursor: string | null;
  /**
   * R8 — ventana de reapertura VIGENTE, en días. La manda el servidor porque es
   * configurable en caliente (Setting): cablearla aquí haría que la UI ofreciera
   * reabrir fuera de plazo en cuanto el admin la cambiara.
   */
  reopenWindowDays: number;
}

/** Payload de POST /tickets. Como máximo UNA entidad enlazada. */
export interface CreateTicketPayload {
  subject: string;
  body: string;
  topicId?: string;
  listingId?: string;
  reviewId?: string;
  invoiceId?: string;
}

/**
 * Fila cruda de Ticket tal y como la devuelven POST /tickets,
 * POST /tickets/:id/messages y POST /tickets/:id/close — el registro entero, no
 * el resumen de la lista (`TicketListItem`, que el backend sí mapea). Se tipa
 * aparte precisamente para no confundir los dos shapes.
 */
export interface TicketRow {
  id: string;
  subject: string;
  status: TicketStatus;
  origin: TicketOrigin;
  topicId: string | null;
  userId: string;
  openedById: string;
  assignedToId: string | null;
  listingId: string | null;
  reviewId: string | null;
  invoiceId: string | null;
  reportId: string | null;
  linkedLabel: string | null;
  lastMessageAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  closedById: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Tickets — vista de STAFF (R7) ────────────────────────────────────────────

export interface TicketUserStub {
  id: string;
  name: string;
  slug: string;
  email: string;
}

/** Fila de la bandeja — GET /admin/tickets. */
export interface AdminTicketListItem {
  id: string;
  subject: string;
  status: TicketStatus;
  origin: TicketOrigin;
  topic: TicketTopic | null;
  user: TicketUserStub;
  assignedTo: { id: string; name: string } | null;
  linkedLabel: string | null;
  /** true si el ticket lleva factura enlazada (solo ADMIN puede gestionarlo). */
  hasInvoice: boolean;
  reportId: string | null;
  lastMessageAt: string;
  createdAt: string;
  /** Mensajes del usuario que ningún agente ha abierto todavía. */
  unreadFromUser: number;
}

export interface AdminTicketsResponse {
  items: AdminTicketListItem[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

/**
 * Hilo completo — GET /admin/tickets/:id. Incluye TODOS los mensajes, también
 * los `internal` (las notas internas siguen aplazadas: no hay forma de crearlas,
 * pero si existieran es aquí donde se verían y en la vista de usuario no).
 */
export interface AdminTicketDetail {
  id: string;
  subject: string;
  status: TicketStatus;
  origin: TicketOrigin;
  topic: TicketTopic | null;
  user: { id: string; name: string; slug: string };
  assignedTo: { id: string; name: string } | null;
  linkedLabel: string | null;
  listing: { id: string; title: string; slug: string } | null;
  review: { id: string; rating: number } | null;
  invoice: { id: string; number: string | null; status: string } | null;
  report: { id: string; reason: string; status: string } | null;
  invoiceId: string | null;
  reportId: string | null;
  lastMessageAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  messages: TicketMessage[];
}

/** Filtros de la bandeja. `assignedTo` admite los centinelas `me` y `none`. */
export interface AdminTicketFilters {
  status?: TicketStatus;
  origin?: TicketOrigin;
  topicId?: string;
  assignedTo?: string;
  page?: number;
  perPage?: number;
}
