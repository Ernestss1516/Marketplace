import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Index } from 'meilisearch';
import type { Listing, ListingImage } from '@prisma/client';
import { MeilisearchService } from '../../infra/meilisearch/meilisearch.service';

export const LISTINGS_INDEX = 'listings';

export interface ListingDocument {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  priceType: string;
  type: string;
  condition: string | null;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  /** Slug of the leaf category followed by all ancestor slugs. Enables filtering by a parent category (X IN categoryPath). */
  categoryPath: string[];
  province: string | null;
  city: string | null;
  /**
   * Geo-coordinates for proximity search/sort.
   * Only populated when the listing has latitude + longitude set.
   * WARNING: StepUbicacion currently captures only city/province/postalCode,
   * so _geo will be absent for all listings until geocoding is added to the
   * publication wizard. Geo search is wired up but will not return results until then.
   */
  _geo?: { lat: number; lng: number };
  slug: string;
  thumbnailUrl: string | null;
  sellerId: string;
  /** UNIX timestamp (seconds). Meilisearch sorts/ranks numbers more efficiently than ISO strings. */
  publishedAt: number;
  /** Flattened category-specific attributes (brand, km, sqm, rooms, gearbox, gender, …). */
  [attribute: string]: unknown;
}

// ---------------------------------------------------------------------------
// Index configuration
// ---------------------------------------------------------------------------

const SEARCHABLE_ATTRIBUTES = [
  // Order defines relevance priority: first = most important.
  'title',
  'brand',
  'model',
  'categoryName',
  'description',
];

// ---------------------------------------------------------------------------
// Variable attribute keys — derived from seed attributeSchema entries where
// filterable: true. Exported so SearchQueryDto and SearchController can import
// this single source of truth instead of maintaining their own copies.
//
// Deliberately EXCLUDED from this list:
//   - "type"  → name-collides with the listing-level ListingType (PRODUCT/SERVICE).
//               The seed uses it in ordenadores/electrodomésticos/accesorios/muebles;
//               it must be renamed (e.g. itemType) in the seed before it can be
//               exposed safely. The spread-order fix in toDocument() already
//               prevents it from overwriting the core `type` field.
//   - "model" → filterable: false in all categories that use it.
//   - "floor" → filterable: false in all categories that use it.
// ---------------------------------------------------------------------------
export const VARIABLE_ATTRIBUTE_KEYS = [
  // Vehículos
  'brand', 'year', 'km', 'fuel', 'gearbox', 'displacement',
  // Inmuebles
  'sqm', 'rooms', 'bathrooms', 'elevator', 'garage', 'pool',
  // Tecnología
  'storage', 'ram',
  // Moda
  // NOTE: size type is inconsistent across categories (string for ropa, number
  // for calzado). Exposed as string; numeric shoe sizes sent as "38" will NOT
  // match Meilisearch documents where size is stored as the number 38. Needs
  // type normalisation in the seed before it can filter reliably.
  'gender', 'size',
  // Servicios
  'specialty', 'subject', 'modality',
] as const;

export type VariableAttributeKey = (typeof VARIABLE_ATTRIBUTE_KEYS)[number];

// Core listing fields that are always filterable regardless of category.
const CORE_FILTERABLE_ATTRIBUTES = [
  'categoryId',
  'categorySlug',
  'categoryPath',
  'type',
  'condition',
  'priceType',
  'price',
  'province',
  'city',
  '_geo',
  'sellerId',
];

// Derived from VARIABLE_ATTRIBUTE_KEYS — the two lists stay in sync automatically.
const FILTERABLE_ATTRIBUTES = [
  ...CORE_FILTERABLE_ATTRIBUTES,
  ...VARIABLE_ATTRIBUTE_KEYS,
];

const SORTABLE_ATTRIBUTES = [
  'price',
  'publishedAt',
  '_geo', // enables _geoPoint(...):asc sorting; only useful when listings carry coordinates
];

// Facets returned in every search response for guided navigation in the UI.
// Only select/boolean attributes with bounded cardinality make sense here.
const FACET_ATTRIBUTES = [
  'categorySlug',
  'type',
  'condition',
  'priceType',
  'province',
  'fuel',
  'gearbox',
  'rooms',
  'gender',
  'modality',
];

const RANKING_RULES = [
  'words',
  'typo',
  'proximity',
  'attribute',
  'sort',
  'exactness',
  'publishedAt:desc', // tiebreak: most-recent listing wins at equal relevance
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shared Prisma include for fetching a listing ready to index.
 * Exported so the indexing processor and the reindex command use the exact
 * same include — if one loaded `parent` and the other didn't, documents would
 * differ depending on the indexing path.
 *
 * NOTE: `parent` covers a 2-level hierarchy (leaf → parent).
 * If the category tree ever grows to 3+ levels the include must walk further
 * up the chain (parent.parent…) and `toDocument` must build the full ancestor
 * array instead of checking only one level.
 */
export const INDEX_INCLUDE = {
  category: {
    select: {
      id: true,
      slug: true,
      name: true,
      parent: { select: { slug: true } },
    },
  },
  images: { orderBy: { order: 'asc' as const } },
} as const;

type ListingWithRelations = Listing & {
  category: { id: string; slug: string; name: string; parent: { slug: string } | null };
  images: ListingImage[];
};

export interface SearchParams {
  q?: string;
  categorySlug?: string;
  type?: string;
  condition?: string;
  priceType?: string;
  minPrice?: number;
  maxPrice?: number;
  province?: string;
  city?: string;
  attributes?: Record<string, string | number | boolean>;
  geo?: { lat: number; lng: number; radiusMeters: number };
  sort?: 'price:asc' | 'price:desc' | 'publishedAt:desc';
  page?: number;
  hitsPerPage?: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private readonly index: Index<ListingDocument>;

  constructor(private readonly meili: MeilisearchService) {
    this.index = this.meili.client.index<ListingDocument>(LISTINGS_INDEX);
  }

  /** Ensures the index exists and its settings are up to date on every startup. */
  async onModuleInit(): Promise<void> {
    try {
      await this.meili.client
        .createIndex(LISTINGS_INDEX, { primaryKey: 'id' })
        .catch(() => undefined); // index already exists — that's fine
      await this.index.updateSettings({
        searchableAttributes: SEARCHABLE_ATTRIBUTES,
        filterableAttributes: FILTERABLE_ATTRIBUTES,
        sortableAttributes: SORTABLE_ATTRIBUTES,
        rankingRules: RANKING_RULES,
        typoTolerance: {
          enabled: true,
          minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
        },
      });
      this.logger.log('Meilisearch index settings applied.');
    } catch (err) {
      this.logger.error('Failed to configure Meilisearch index', err);
    }
  }

  // --------------------------------------------------------------------------
  // Write operations
  // --------------------------------------------------------------------------

  /**
   * Indexes a single listing. If the listing is not ACTIVE it is removed from
   * the index instead (handles reserve → RESERVED, sold → SOLD, etc.).
   */
  async indexListing(listing: ListingWithRelations): Promise<void> {
    if (listing.status !== 'ACTIVE') {
      await this.removeListing(listing.id);
      return;
    }
    await this.index.addDocuments([this.toDocument(listing)]);
  }

  /** Removes a listing from the index. Safe to call even when the document is absent. */
  async removeListing(id: string): Promise<void> {
    await this.index.deleteDocument(id);
  }

  /**
   * Bulk-indexes an array of listings, ignoring any that are not ACTIVE.
   * Used by the reindex command and, in the future, by admin-triggered reindexing.
   */
  async reindexAll(listings: ListingWithRelations[]): Promise<void> {
    const docs = listings
      .filter((l) => l.status === 'ACTIVE')
      .map((l) => this.toDocument(l));
    if (docs.length === 0) return;
    await this.index.addDocuments(docs);
  }

  // --------------------------------------------------------------------------
  // Search
  // --------------------------------------------------------------------------

  /**
   * Full-text search with filters, facets, geo, and sorting.
   * Returns the raw Meilisearch response; the controller maps it to the API contract.
   */
  async search(params: SearchParams) {
    const filters: string[] = [];

    if (params.categorySlug) filters.push(`categoryPath = "${this.escape(params.categorySlug)}"`);
    if (params.type) filters.push(`type = "${this.escape(params.type)}"`);
    if (params.condition) filters.push(`condition = "${this.escape(params.condition)}"`);
    if (params.priceType) filters.push(`priceType = "${this.escape(params.priceType)}"`);
    if (params.province) filters.push(`province = "${this.escape(params.province)}"`);
    if (params.city) filters.push(`city = "${this.escape(params.city)}"`);
    if (params.minPrice != null) filters.push(`price >= ${params.minPrice}`);
    if (params.maxPrice != null) filters.push(`price <= ${params.maxPrice}`);

    for (const [key, value] of Object.entries(params.attributes ?? {})) {
      filters.push(
        typeof value === 'string'
          ? `${key} = "${this.escape(value)}"`
          : `${key} = ${value}`,
      );
    }

    if (params.geo) {
      filters.push(
        `_geoRadius(${params.geo.lat}, ${params.geo.lng}, ${params.geo.radiusMeters})`,
      );
    }

    const sort: string[] = [];
    if (params.geo && !params.sort) {
      // Default: order by proximity when a geo point is given and no explicit sort.
      sort.push(`_geoPoint(${params.geo.lat}, ${params.geo.lng}):asc`);
    } else if (params.sort) {
      sort.push(params.sort);
    }

    return this.index.search(params.q ?? '', {
      filter: filters.length ? filters : undefined,
      sort: sort.length ? sort : undefined,
      facets: FACET_ATTRIBUTES,
      page: params.page ?? 1,
      hitsPerPage: params.hitsPerPage ?? 24,
    });
  }

  // --------------------------------------------------------------------------
  // Mapping
  // --------------------------------------------------------------------------

  /** Escapes backslashes and double-quotes in Meilisearch filter string values. */
  private escape(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private toDocument(listing: ListingWithRelations): ListingDocument {
    const attributes = (listing.attributes as Record<string, unknown>) ?? {};
    const thumbnail = listing.images.find((img) => img.order === 0) ?? listing.images[0];

    // Variable attributes are spread FIRST so that no category attribute can
    // overwrite the core fields below (guards against seeds that reuse reserved
    // names such as "type", which conflicts with the listing-level ListingType).
    return {
      ...attributes,
      id: listing.id,
      title: listing.title,
      description: listing.description,
      price: Number(listing.price),
      currency: listing.currency,
      priceType: listing.priceType,
      type: listing.type,
      condition: listing.condition,
      categoryId: listing.category.id,
      categorySlug: listing.category.slug,
      categoryName: listing.category.name,
      categoryPath: [
        listing.category.slug,
        ...(listing.category.parent ? [listing.category.parent.slug] : []),
      ],
      province: listing.province,
      city: listing.city,
      ...(listing.latitude != null && listing.longitude != null
        ? { _geo: { lat: listing.latitude, lng: listing.longitude } }
        : {}),
      slug: listing.slug,
      thumbnailUrl: thumbnail?.url ?? null,
      sellerId: listing.sellerId,
      publishedAt: listing.publishedAt
        ? Math.floor(listing.publishedAt.getTime() / 1000)
        : 0,
    };
  }
}
