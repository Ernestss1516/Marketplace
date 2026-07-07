import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Index } from 'meilisearch';
import type { Listing, ListingImage, Entitlement } from '@prisma/client';
import { MeilisearchService } from '../../infra/meilisearch/meilisearch.service';
import { FilterableAttributesResolver } from './filterable-attributes.resolver';

export const LISTINGS_INDEX = process.env.MEILI_INDEX_NAME ?? 'listings';

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
   */
  _geo?: { lat: number; lng: number };
  slug: string;
  thumbnailUrl: string | null;
  sellerId: string;
  /** Public seller fields — stored in the index so the map panel avoids a per-selection fetch. */
  sellerName: string;
  sellerSlug: string;
  sellerAvatarUrl: string | null;
  /** UNIX timestamp (ms). max(publishedAt, bumpedAt) so a bump resurfaces the listing. */
  sortDate: number;
  /** UNIX timestamp (seconds). Meilisearch sorts/ranks numbers more efficiently than ISO strings. */
  publishedAt: number;
  /** 1 if listing has an active (non-revoked, non-expired) FEATURED_LISTING entitlement; 0 otherwise. */
  boostScore: 0 | 1;
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
// Core listing fields that are always filterable regardless of category.
// The variable part of Meilisearch's filterableAttributes (brand, fuel, sqm,
// itemType, …) is resolved dynamically at startup by
// FilterableAttributesResolver from Category.attributeSchema instead of a
// hardcoded list — see onModuleInit below.
// ---------------------------------------------------------------------------
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

const SORTABLE_ATTRIBUTES = [
  'price',
  'publishedAt',
  'sortDate',
  '_geo', // enables _geoPoint(...):asc sorting; only useful when listings carry coordinates
];

// Facets returned in every search response for guided navigation in the UI.
// Only select/boolean attributes with bounded cardinality make sense here.
// Curated editorially — NOT auto-derived from the schema like filterableAttributes.
// Names here that aren't (yet) filterable in the live environment (e.g. an
// attribute only present in the production seed but not in a lighter test
// fixture) are dropped at query time in search() — see filterableAttributeNames.
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
  'itemType',
];

const RANKING_RULES = [
  'words',
  'typo',
  'proximity',
  'attribute',
  // Featured listings rise after textual relevance; before user-applied sort so they
  // remain visible in every ordering. Does NOT boost irrelevant results.
  'boostScore:desc',
  'sort',
  'exactness',
  // Final tiebreaker: most recently published/bumped listing wins.
  // Replaces the old publishedAt:desc now that sortDate = max(publishedAt, bumpedAt).
  'sortDate:desc',
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
  // Only non-revoked FEATURED_LISTING entitlements; expiresAt is checked in toDocument()
  // because new Date() must be evaluated at index time, not at module-load time.
  entitlements: {
    where: { type: 'FEATURED_LISTING' as const, revokedAt: null },
    select: { expiresAt: true },
  },
  // Public seller fields stored in the index so the map panel can display them
  // without a per-selection API fetch.
  seller: { select: { name: true, slug: true, avatarUrl: true } },
} as const;

type ListingWithRelations = Listing & {
  category: { id: string; slug: string; name: string; parent: { slug: string } | null };
  images: ListingImage[];
  entitlements: Pick<Entitlement, 'expiresAt'>[];
  seller: { name: string; slug: string; avatarUrl: string | null };
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
  sort?: 'price:asc' | 'price:desc' | 'publishedAt:desc' | 'sortDate:desc';
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
  // Populated in onModuleInit; used to keep the requested facets (below) a
  // subset of what's actually filterable — see the comment on FACET_ATTRIBUTES.
  private filterableAttributeNames = new Set<string>(CORE_FILTERABLE_ATTRIBUTES);

  constructor(
    private readonly meili: MeilisearchService,
    private readonly attributesResolver: FilterableAttributesResolver,
  ) {
    this.index = this.meili.client.index<ListingDocument>(LISTINGS_INDEX);
  }

  /** Ensures the index exists and its settings are up to date on every startup. */
  async onModuleInit(): Promise<void> {
    try {
      const attributeTypes = await this.attributesResolver.getAttributeTypes();
      const filterableAttributes = [...CORE_FILTERABLE_ATTRIBUTES, ...attributeTypes.keys()];
      this.filterableAttributeNames = new Set(filterableAttributes);

      await this.meili.client
        .createIndex(LISTINGS_INDEX, { primaryKey: 'id' })
        .catch(() => undefined); // index already exists — that's fine
      await this.index.updateSettings({
        searchableAttributes: SEARCHABLE_ATTRIBUTES,
        filterableAttributes,
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
    // waitForTask ensures the document is queryable before this method returns.
    // Without it, addDocuments() is fire-and-forget: the BullMQ job completes but
    // Meilisearch may not have processed the task yet, causing tests (and real
    // users) to see a stale index for a brief but unpredictable window.
    const task = await this.index.addDocuments([this.toDocument(listing)]);
    await this.meili.client.waitForTask(task.taskUid);
  }

  /** Removes a listing from the index. Safe to call even when the document is absent. */
  async removeListing(id: string): Promise<void> {
    await this.index.deleteDocument(id);
  }

  /**
   * Deletes every document from the index and waits for Meilisearch to finish.
   * Called by the reindex command before repopulating so that orphaned documents
   * (e.g. from a Postgres reset in dev) do not survive.
   */
  async clearAll(): Promise<void> {
    const task = await this.index.deleteAllDocuments();
    await this.meili.client.waitForTask(task.taskUid);
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

    // Meilisearch rejects a facet request for any attribute not currently in
    // filterableAttributes. FACET_ATTRIBUTES is curated independently of the
    // dynamically-resolved filterable set, so intersect defensively instead of
    // assuming the two always agree.
    const facets = FACET_ATTRIBUTES.filter((f) => this.filterableAttributeNames.has(f));

    return this.index.search(params.q ?? '', {
      filter: filters.length ? filters : undefined,
      sort: sort.length ? sort : undefined,
      facets,
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
      sellerName: listing.seller.name,
      sellerSlug: listing.seller.slug,
      sellerAvatarUrl: listing.seller.avatarUrl,
      publishedAt: listing.publishedAt
        ? Math.floor(listing.publishedAt.getTime() / 1000)
        : 0,
      // max(publishedAt, bumpedAt) in ms — bump resurfaces the listing; renew does not
      // (renew preserves publishedAt and never sets bumpedAt).
      sortDate: Math.max(
        listing.publishedAt?.getTime() ?? 0,
        listing.bumpedAt?.getTime() ?? 0,
      ),
      // 1 if a non-revoked, non-expired FEATURED_LISTING entitlement exists; 0 otherwise.
      // expiresAt=null means the entitlement never expires (permanent featured).
      // Evaluated at index time; decays to 0 when the B.1 expiration cron re-indexes (~daily).
      boostScore: listing.entitlements.some(
        (e) => e.expiresAt == null || e.expiresAt > new Date(),
      )
        ? 1
        : 0,
    };
  }
}
