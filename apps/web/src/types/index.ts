import type { Block } from './blocks';
import type { BumpScheduleSummary } from '@/lib/api/bump-schedules';

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
  /** A2 — si vale como filtro de búsqueda. Lo emite `GET /categories` en `allAttributes`
   *  (opcional porque `cardAttributes`/`wideCardAttributes` comparten este tipo y ahí no
   *  se usa). Decide qué query params sobreviven al cambiar de categoría — ver
   *  lib/filter-carry.ts: mandar un atributo no filtrable da 400 igual que uno ajeno. */
  filterable?: boolean;
  /** A3 — CÓMO se pinta el filtro. Los emite `GET /categories` en `allAttributes`; en la
   *  ruta de categoría salen del `attributeSchema` completo. Opcionales por el mismo
   *  motivo que `filterable`: este tipo lo comparten las listas de card, donde no aplican. */
  type?: AttributeSchema['type'];
  options?: string[];
  dependsOn?: string;
  optionsByParent?: Record<string, string[]>;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  /** A1 (URLs anidadas) — slug del padre; ausente en las raíces. Lo emite
   *  `GET /categories` en cada hija para que `categoryPath()` construya la URL
   *  canónica sin recorrer el árbol al revés. */
  parentSlug?: string;
  /** PROFUNDIDAD N — RÁFAGA 3: la CADENA de ancestros (raíz → padre inmediato),
   *  `[]` en las raíces. Sustituye a `parentSlug` como fuente de la URL canónica;
   *  `parentSlug` se conserva porque hay payloads cacheados que sólo lo traen y
   *  para 1-2 niveles ambos dan la misma URL. */
  ancestorSlugs?: string[];
  /** A2 — política EFECTIVA (propia + heredada), resuelta por el backend en el árbol.
   *  La usa el cambio de categoría para decidir si `condition` sobrevive al destino. */
  allowedListingType?: ListingTypePolicy;
  iconUrl?: string;
  cardAttributes?: CardAttributeDef[];
  /** Hasta 6 atributos para la vista ampliada (RÁFAGA 2) — independiente de cardAttributes. */
  wideCardAttributes?: CardAttributeDef[];
  /** Full attribute list (all fields, not just card-highlighted ones). Populated by GET /categories tree. */
  allAttributes?: CardAttributeDef[];
  /** B3 — etiquetas EFECTIVAS de este nodo (propias + heredadas del padre, solo
   *  activas), resueltas por el backend en el árbol. Mismo papel que `allAttributes`:
   *  decidir si `?tags=` sobrevive al cambiar de categoría, sin un viaje extra. */
  tags?: TagRef[];
  children?: Category[];
}

export interface CategoryWithSchema extends Category {
  /** A1 — categoría padre (o null si es raíz). La emite `GET /categories/:slug`.
   *  Alimenta el breadcrumb (Inicio > Vehículos > Coches) y la URL canónica.
   *  PROFUNDIDAD N — RÁFAGA 3: se conserva junto a `ancestors` para no romper los
   *  payloads cacheados; para 1-2 niveles las dos formas dan lo mismo. */
  parent?: { slug: string; name: string } | null;
  /** PROFUNDIDAD N — RÁFAGA 3: la CADENA completa de ancestros (raíz → padre
   *  inmediato), `[]` si es raíz. Alimenta la miga de N escalones y la URL
   *  canónica de cualquier profundidad. */
  ancestors?: { slug: string; name: string }[];
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
  /** B2 — tags EFECTIVOS de la categoría (propios + heredados del padre, solo
   *  activos, los propios primero). Los resuelve el backend en el mismo
   *  `GET /categories/:slug` que el wizard ya pide al elegir categoría, así que no
   *  hace falta un segundo viaje. Opcional por el mismo motivo que
   *  `allowedPriceUnits`: una API anterior a B2 no lo trae → sin tags → el paso del
   *  wizard no existe, que es el comportamiento pre-B2. */
  tags?: TagRef[];
  /** B2 — tope vigente de etiquetas por anuncio (`maxTagsPerListing`, configurable).
   *  Viaja aquí para que el contador del wizard use el número REAL en vez de una
   *  copia del default escrita en el front. */
  maxTags?: number;
}

/** B2 — una etiqueta tal como la ve el público: identificar, filtrar y mostrar. */
export interface TagRef {
  id: string;
  slug: string;
  name: string;
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

/** PUERTA ráfaga 2 — un motivo por el que un anuncio necesita revalidarse. */
export interface RevalidationReason {
  /** Código estable (`ATTRIBUTE_REQUIRED_MISSING`, `ATTRIBUTE_VALUE_INVALID`…). */
  code: string;
  /** Texto listo para enseñar, ya en español. */
  message: string;
  /** El atributo al que apunta, para que el editor pueda señalarlo. */
  field: string;
}

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
  /** UXV.1 (A2) — instante en que el anuncio vuelve a ser bumpeable, DERIVADO EN EL
   *  BACKEND a partir de `bumpedAt` y de la ventana real (ver `bump-cooldown.ts` en la
   *  API). El frontend solo lo compara contra `Date.now()`: no vuelve a calcular la
   *  ventana, que es lo que hacía divergir a la tarjeta (24 h) del backend (1 h).
   *  Solo lo sirve la vista del propietario (`findMine`), como `featuredUntil`; en los
   *  listados públicos y en los hits de Meilisearch no viene. `null` = nunca bumpeado. */
  nextBumpAt?: string | null;
  /** Vídeo Pro — SOLO el booleano; la URL del vídeo NUNCA viaja a una lista, para que una
   *  tarjeta no pueda descargarlo. Lo sirven tanto Meilisearch como los payloads de
   *  Postgres. */
  hasVideo?: boolean;
  /** PÓSTER ANIMADO — el SPRITE: los cinco fotogramas del vídeo en una tira, dentro de una
   *  IMAGEN FIJA (20-45 KB, del orden de la portada). La tarjeta lo anima por CSS al pasar
   *  el ratón, y sólo lo MONTA en ese momento: que la URL viaje no descarga nada.
   *
   *  Ésta sí viaja y la del vídeo no, y la diferencia es de naturaleza: con una imagen no
   *  se puede montar un `<video>`.
   *
   *  `undefined`/`null` = este anuncio no tiene previsualización (todos los vídeos
   *  anteriores a la ráfaga que la introdujo, y cualquier captura fallida). Es un estado
   *  NORMAL: la tarjeta se comporta entonces como siempre. */
  videoPreviewUrl?: string | null;
  /** Bump automático — la programación de este anuncio, si la tiene. Igual que `nextBumpAt`,
   *  SOLO la sirve la vista de propietario (`findMine`): que un vendedor programe bumps es
   *  asunto suyo y no viaja en ningún payload público. `null` = no tiene programación. */
  bumpSchedule?: BumpScheduleSummary | null;
  /** PUERTA ráfaga 2 — el anuncio dejó de cumplir la configuración de su categoría
   *  (un administrador la cambió por debajo). SIGUE ACTIVO Y VISIBLE: esto no es un
   *  estado del ciclo de vida, es un aviso para su dueño. Como `bumpSchedule`, sólo
   *  viaja en la vista de propietario (`findMine`) — nunca en los listados públicos
   *  ni en los hits de Meilisearch. */
  needsRevalidation?: boolean;
  /** Qué hay que corregir, ya calculado por la API. Sólo viene relleno cuando
   *  `needsRevalidation` es true. Sin esto el aviso podría anunciar el problema pero
   *  no llevar a la solución. */
  revalidationReasons?: RevalidationReason[];
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
  /** B2 — tags asignados al anuncio, ya aplanados a TagRef[] por el backend.
   *  Opcional: la ficha se cachea en Redis 5 min, así que justo tras desplegar
   *  habrá payloads sin él (mismo precedente que `category.parent` en A1). */
  tags?: TagRef[];
  city?: string;
  province?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  images: ListingImage[];
  /** A1 — `parent` es opcional a propósito: la ficha se cachea en Redis 5 min, así que
   *  justo tras desplegar habrá payloads sin él. `categoryPath()` lo tolera (emite la
   *  URL plana, que el catch-all redirige) y el breadcrumb cae a 2 niveles. */
  category: Pick<Category, 'name' | 'slug'> & { parent?: { slug: string; name: string } | null };
  seller: Pick<UserPublic, 'name' | 'slug' | 'avatarUrl' | 'trusted'> & {
    /** Escaparate RÁFAGA 4 — media VERIFICADA, siempre fresca (nunca dentro de la caché
     * de 5 min de la ficha). null = sin valoraciones verificadas → "Nuevo". */
    ratingAverage: number | null;
    ratingCount: number;
  };
  publishedAt?: string;
  viewCount: number;
  featuredUntil?: string | null;
  /** UXV.1 (A2) — misma fuente y mismo significado que en `ListingSummary`: la ficha y
   *  la tarjeta de /mis-anuncios consumen el MISMO instante, derivado en el backend, en
   *  vez de calcular cada una su ventana. Se sirve fuera del blob cacheado en Redis
   *  (como `featuredUntil`), y `bump` invalida esa caché para que no quede viejo. */
  nextBumpAt?: string | null;
  /** true cuando el anuncio tiene teléfono publicado — el número en sí nunca viaja aquí (ver GET /listings/:id/phone). */
  hasPhone: boolean;
  /** Vídeo Pro — aquí SÍ viaja la URL: la ficha es donde el vídeo se ve. En las listas
   *  solo viaja `hasVideo`, para que una tarjeta no pueda descargarlo. */
  videoUrl?: string | null;
  videoPosterUrl?: string | null;
}

// ── H8 Bloque C — estadísticas de anuncios ──────────────────────────────────

/**
 * A2 — el CTR («de cada N veces que apareces, cuántas personas entran»), tal y como lo
 * sirve el backend. El VALOR puede ser `null`, y no es un fallo: significa que aún no hay
 * apariciones suficientes para que el porcentaje signifique algo. Los conteos viajan
 * igualmente para poder decir «llevas 37 de las 100 que hacen falta».
 *
 * `views`/`impressions` NO son los totales del anuncio: son los de la ventana comparable
 * (desde el primer día con apariciones). Ver `listing-ctr.ts` en el backend, que es donde
 * vive la regla — aquí solo se pinta.
 */
export interface ListingCtr {
  value: number | null;
  views: number;
  impressions: number;
  minImpressions: number;
}

/**
 * El ratio de me gusta, con LA MISMA forma que `ListingCtr` y por la misma razón: era un
 * porcentaje rotundo sobre una muestra que podía ser de una sola visita. `value: null`
 * significa «aún no hay visitas suficientes», no cero.
 *
 * A diferencia del CTR, sus dos números son los TOTALES del anuncio (los me gusta también
 * son de toda su vida), no los de una ventana.
 */
export interface ListingLikeRatio {
  value: number | null;
  favorites: number;
  views: number;
  minViews: number;
}

/** GET /listings/mine/:id/stats — enriquecido con dailyViews/likeRatio solo si el dueño es Pro. */
export interface ListingStats {
  viewCount: number;
  favoritesCount: number;
  /** A2 — «veces listado». Solo Pro. */
  impressionCount?: number;
  dailyViews?: { date: string; count: number }[];
  /** A2 — la serie diaria de «veces listado». Solo Pro. */
  dailyImpressions?: { date: string; count: number }[];
  likeRatio?: ListingLikeRatio;
  /** A2 — solo Pro. */
  ctr?: ListingCtr;
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
  /** B2 — etiquetas por SLUG. El backend valida pertenencia a la categoría y tope. */
  tags?: string[];
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
  /** B2 — etiquetas por SLUG. REEMPLAZO COMPLETO: `[]` las quita todas. Omitirlo las
   *  deja intactas, que es lo que protege a un anuncio antiguo de revalidarse contra
   *  un tope que bajó después de publicarse. */
  tags?: string[];
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
  /** Vídeo Pro — solo en la vista de PROPIETARIO; la URL nunca viaja a las listas. */
  videoUrl?: string | null;
  videoPosterUrl?: string | null;
  /** B2 — tags asignados al anuncio, ya aplanados a TagRef[] por el backend.
   *  Opcional: la ficha se cachea en Redis 5 min, así que justo tras desplegar
   *  habrá payloads sin él (mismo precedente que `category.parent` en A1). */
  tags?: TagRef[];
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

// FUGA DE FAVORITOS — este tipo describía la FILA CRUDA del anuncio que `/favorites`
// devolvía (relaciones anidadas en bruto, y con ellas `phone`, `lastOwnerIp`, `triage`…).
// La API ya no la sirve: `/favorites` pasa por el mismo `toSummary` que las otras diez
// listas, así que `listing` es un `ListingSummary` a secas. Sin `FavoriteListingData` no
// hay una segunda forma de anuncio que el frontend pueda volver a asumir.
export interface FavoriteItem {
  id: string;
  listingId: string;
  createdAt: string;
  listing: ListingSummary;
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

/**
 * NOTIFICACIONES A1 — DERIVADO DE LA UNIÓN, ya no escrito a mano.
 *
 * Escrito a mano se quedó en tres valores mientras el backend llegaba a doce: era
 * una segunda lista de tipos, desactualizada, esperando a que alguien la creyera.
 * Derivándolo de `NotificationItem` no puede volver a desalinearse — hay UNA
 * fuente, la unión discriminada, que es además la que impone los `case`.
 */
export type NotificationType = NotificationItem['type'];

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

// ── Moderación (§14.5) ───────────────────────────────────────────────────────
// Espejo de notification.types.ts. Snapshots autocontenidos: nombres resueltos y
// títulos congelados, para que el aviso siga siendo legible si la entidad
// denunciada o moderada desaparece después.

export interface ReportResolvedData {
  reportId: string;
  outcome: 'RESOLVED' | 'DISMISSED';
  targetType: 'LISTING' | 'REVIEW' | 'USER';
  targetLabel: string;
  listingSlug: string | null;
}

export interface ListingModeratedData {
  listingId: string;
  listingTitle: string;
  /**
   * NOTIFICACIONES A1 — `APPROVED` FALTABA AQUÍ, y ésta era la causa real del
   * defecto. El backend emite los cuatro valores (`approveListing` manda
   * `'APPROVED'` desde M2, y el email tiene su copy), pero este espejo declaraba
   * sólo tres. El mapa de `notification-content.ts` era entonces **correcto contra
   * un tipo equivocado**: tenía las tres claves que este `action` decía tener, así
   * que el compilador no vio nada raro y el aviso de «tu anuncio ya está
   * publicado» se pintaba vacío mientras el correo salía bien.
   *
   * El espejo se mantiene a mano y se desalineó en silencio. Mientras siga siendo
   * a mano, el mapa exhaustivo del `case` es lo que convierte un desajuste futuro
   * en un error de compilación en vez de en una notificación en blanco.
   */
  action: 'APPROVED' | 'REJECTED' | 'DEACTIVATED' | 'RESTORED';
  reason: string | null;
}

export interface ReviewModeratedData {
  reviewId: string;
  rating: number;
  listingTitle: string | null;
  targetName: string;
  /**
   * A1 — `RETIRED` deja de verse; `EDITED` sigue publicada con el texto o las
   * estrellas cambiados. Sin este discriminante, editar una valoración le decía a
   * su autor que se la habían retirado.
   */
  /**
   * `RESTORED` entra en N4a y cierra la asimetría: retirar avisaba, devolver la
   * valoración no. «Avisar solo de lo malo sería la mitad de la conversación».
   */
  action: 'RETIRED' | 'EDITED' | 'RESTORED';
  /**
   * N2 — el motivo que escribió el moderador. Los dos caminos lo exigían desde
   * siempre y hasta ahora se descartaba: se le retiraba a alguien lo que había
   * escrito y se le comunicaba sin decirle por qué. `RESTORED` va siempre sin
   * motivo: deshacer no se justifica ante quien se beneficia.
   */
  reason: string | null;
}

/** Espejo de ReviewReceivedData en el backend (N4a) — te han valorado. */
export interface ReviewReceivedData {
  reviewId: string;
  rating: number;
  /** Nombre del autor, resuelto y congelado. */
  authorName: string;
  authorSlug: string | null;
  listingTitle: string | null;
}

/**
 * Espejo de `ListingLifecycleAction` en el backend (N3) — lo que le pasa a un
 * anuncio SIN que su dueño lo haya pedido.
 *
 * Las acciones propias (pausar, renovar, destacar, editar o borrar por su mano) no
 * están y no deben estar: avisar a alguien de lo que acaba de hacer es ruido.
 */
export type ListingLifecycleAction =
  | 'RECEIVED'
  | 'EXPIRING_SOON'
  | 'EXPIRED'
  | 'EDITED_BY_STAFF'
  | 'DELETED_BY_STAFF'
  | 'FEATURED_EXPIRED';

/** Espejo de ListingLifecycleData en el backend (N3). */
export interface ListingLifecycleData {
  listingId: string;
  /** Congelado: el aviso sobrevive al borrado del anuncio. */
  listingTitle: string;
  action: ListingLifecycleAction;
  /** Hoy sólo lo lleva EDITED_BY_STAFF. Degradación limpia si es null. */
  reason: string | null;
  /** Sólo en EXPIRING_SOON. */
  daysLeft: number | null;
}

/**
 * Espejo de `AccountModeratedAction` en el backend (N2).
 *
 * `DELETED` no está: eliminar una cuenta borra sus notificaciones, así que ese
 * aviso es sólo correo y nunca llega a esta unión.
 */
export type AccountModeratedAction =
  | 'SUSPENDED'
  | 'UNSUSPENDED'
  | 'BANNED'
  | 'REINSTATED'
  | 'ARCHIVED'
  | 'ROLE_CHANGED';

/**
 * Espejo de AccountModeratedData en el backend (N2) — las decisiones sobre la
 * cuenta, que hasta esta ráfaga no avisaban a nadie.
 *
 * `reason` es SIEMPRE el motivo visible. La nota interna del staff no tiene campo
 * aquí, y es a propósito: no hay dónde meterla ni por descuido.
 */
export interface AccountModeratedData {
  action: AccountModeratedAction;
  reason: string | null;
  /** Sólo en SUSPENDED: ISO-8601, o null si es indefinida. */
  suspendedUntil: string | null;
  /** Sólo en ROLE_CHANGED. */
  newRole: string | null;
}

/** Espejo de DataExportReadyData en el backend (Borrado de cuentas C6). */
export interface DataExportReadyData {
  exportId: string;
  /** ISO-8601. Congelado: el aviso sobrevive a que la exportación caduque. */
  expiresAt: string;
  sizeBytes: number;
}

/** Bump automático — la programación se paró; `reason` decide el texto y la salida. */
export interface BumpAutoPausedData {
  scheduleId: string;
  listingId: string;
  listingTitle: string;
  reason: 'NO_FUNDS' | 'LISTING_INACTIVE';
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
  | (NotificationBase & { type: 'TICKET_STAFF_NEW'; data: TicketStaffNewData })
  | (NotificationBase & { type: 'REPORT_RESOLVED'; data: ReportResolvedData })
  | (NotificationBase & { type: 'LISTING_MODERATED'; data: ListingModeratedData })
  | (NotificationBase & { type: 'REVIEW_MODERATED'; data: ReviewModeratedData })
  | (NotificationBase & { type: 'BUMP_AUTO_PAUSED'; data: BumpAutoPausedData })
  // A1 — el tipo que el backend creaba desde C6 y que nunca llegó a esta unión,
  // porque se escribía con `prisma.notification.create()` directo. Sin miembro
  // aquí no había `case` que exigir, y el aviso salía como «Nueva notificación».
  | (NotificationBase & { type: 'DATA_EXPORT_READY'; data: DataExportReadyData })
  // N2 — las decisiones sobre la cuenta. Para un sancionado la campana es
  // constancia (no puede abrirla hasta que vuelva); el canal que le llega es el
  // correo. Se pinta igual, porque cuando vuelva querrá encontrar el porqué.
  | (NotificationBase & { type: 'ACCOUNT_MODERATED'; data: AccountModeratedData })
  // N3 — el ciclo de vida del anuncio: lo que le pasa sin que su dueño lo pida.
  // El caso que más falta hacía es EXPIRED («desapareció y no sé por qué»).
  | (NotificationBase & { type: 'LISTING_LIFECYCLE'; data: ListingLifecycleData })
  // N4a — «el evento más notificable que quedaba sin cubrir»: alguien escribe
  // públicamente sobre ti, queda en tu perfil y cuenta para tu media.
  | (NotificationBase & { type: 'REVIEW_RECEIVED'; data: ReviewReceivedData });

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
/**
 * R5 — adjunto tal y como llega en el hilo. **No incluye la `key` de R2**: el
 * backend no la sirve a propósito (no hay URL pública en ningún sitio; el fichero
 * se pide por su id al endpoint autenticado de descarga).
 */
export interface TicketAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

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
  attachments?: TicketAttachment[];
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
  /**
   * #15 — el autor es cliente Pro AHORA (no «lo era al abrir el ticket»).
   *
   * Es lo que hace real el «soporte prioritario» que anuncia `/planes`: la bandeja lo
   * marca para que el staff pueda priorizarlo. NO reordena la cola ni promete un plazo.
   */
  userIsPro: boolean;
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
  /** #15 — sólo los tickets de clientes Pro. La cola del soporte prioritario, aislable. */
  soloPro?: boolean;
  page?: number;
  perPage?: number;
}

/**
 * B4 — sugerencia del buscador de portada: la etiqueta más cuántos anuncios la llevan
 * en el ámbito consultado. `count: 0` es legítimo y se muestra — un vocabulario recién
 * configurado tiene que poder sugerirse antes de que nadie publique con él.
 */
export interface TagSuggestion extends TagRef {
  count: number;
}
