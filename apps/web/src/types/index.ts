// Enums — mirror the Prisma schema
export type PriceType = 'FIXED' | 'FREE' | 'NEGOTIABLE';

export type ListingStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'ACTIVE'
  | 'RESERVED'
  | 'SOLD'
  | 'EXPIRED'
  | 'REJECTED';

export type ListingType = 'PRODUCT' | 'SERVICE';

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
}

export interface CardAttributeDef {
  key: string;
  label: string;
  unit?: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  iconUrl?: string;
  cardAttributes?: CardAttributeDef[];
  /** Full attribute list (all fields, not just card-highlighted ones). Populated by GET /categories tree. */
  allAttributes?: CardAttributeDef[];
  children?: Category[];
}

export interface CategoryWithSchema extends Category {
  attributeSchema: AttributeSchema[];
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
  city?: string;
  province?: string;
  status: ListingStatus;
  publishedAt?: string;
  expiresAt?: string;
  bumpedAt?: string;
  featuredUntil?: string | null;
  categorySlug?: string;
  attributes?: Record<string, unknown>;
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
  seller: Pick<UserPublic, 'name' | 'slug' | 'avatarUrl'>;
  publishedAt?: string;
  viewCount: number;
  featuredUntil?: string | null;
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
  type?: ListingType;
  condition?: Condition;
  categoryId?: string;
  attributes?: Record<string, unknown>;
  city?: string;
  province?: string;
  postalCode?: string;
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
  images: MyListingImage[];
  category: { id: string; name: string; slug: string };
  publishedAt?: string;
}

// ── Favorites ────────────────────────────────────────────────────────────────

export interface FavoriteListingData extends ListingSummary {
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
  body: string;
  metaTitle: string | null;
  metaDescription: string | null;
}
