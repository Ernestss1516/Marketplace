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
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  iconUrl?: string;
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
