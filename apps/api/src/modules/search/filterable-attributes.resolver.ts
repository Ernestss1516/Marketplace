import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { resolveEffectiveSchema, type AttributeField } from '../categories/category.types';

// Query-string / document-field names already claimed by the fixed search
// filters (SearchQueryDto's core fields plus Meilisearch's always-filterable
// core document fields). A category attribute sharing one of these names
// would be indistinguishable from the core filter at the query-string level
// (see the historical `type` vs `itemType` collision in the seed) — excluded
// structurally here instead of relying on a seed-authoring convention.
const RESERVED_ATTRIBUTE_NAMES = new Set([
  // SearchQueryDto core query params
  'q', 'category', 'type', 'condition', 'priceType', 'minPrice', 'maxPrice',
  'province', 'city', 'sort', 'page', 'hitsPerPage', 'lat', 'lng', 'radius',
  // Meilisearch core document fields (CORE_FILTERABLE_ATTRIBUTES in search.service.ts)
  'categoryId', 'categorySlug', 'categoryPath', 'price', '_geo', 'sellerId',
]);

interface CategoryAttrEntry {
  slug: string;
  parentSlug: string | null;
  schema: AttributeField[];
}

/**
 * Resolves which category-attribute names are valid filters, derived from
 * `Category.attributeSchema` instead of a hardcoded list. Replaces the
 * previous VARIABLE_ATTRIBUTE_KEYS constant.
 *
 * Two resolution modes:
 *  - getAttributeTypes(): flat union across EVERY category — used by
 *    /busqueda general (no category filter narrows the result set, so any
 *    attribute from any category is a legitimate filter) and by
 *    SearchService to configure Meilisearch's filterableAttributes (which is
 *    global, not per-category).
 *  - getAttributeTypesForCategory(slug): scoped to one category — used
 *    whenever the query carries `category=slug` (RÁFAGA 1: fixes the
 *    cross-category leak where e.g. /coches?rooms=3 silently validated
 *    "rooms", an attribute that only exists on "pisos", and returned 0
 *    results with no explanation).
 */
@Injectable()
export class FilterableAttributesResolver {
  private readonly logger = new Logger(FilterableAttributesResolver.name);
  private cache: Promise<CategoryAttrEntry[]> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Flat union of filterable attribute names across every category (parents
   * and leaves alike) — answers "which keys exist as filters in the whole
   * system", not "which schema applies to one category".
   */
  async getAttributeTypes(): Promise<ReadonlyMap<string, AttributeField['type']>> {
    const categories = await this.loadCategories();
    return this.toMap(categories.flatMap((c) => c.schema));
  }

  /**
   * Scoped to a single category: for a LEAF, its own schema plus what it
   * inherits from its parent (resolveEffectiveSchema — same rule used
   * everywhere else attribute inheritance applies). For a PARENT (has
   * children), the union of its own schema plus every child's effective
   * schema — because browsing a parent's slug in Meilisearch
   * (`categoryPath = "parentSlug"`) mixes in every child's listings, so a
   * child-specific attribute (e.g. "fuel" while browsing "vehiculos") is a
   * legitimate filter there too.
   *
   * An unknown slug resolves to an empty map — no attribute is valid for a
   * category that doesn't exist.
   */
  async getAttributeTypesForCategory(
    categorySlug: string,
  ): Promise<ReadonlyMap<string, AttributeField['type']>> {
    const categories = await this.loadCategories();
    const bySlug = new Map(categories.map((c) => [c.slug, c]));
    const target = bySlug.get(categorySlug);
    if (!target) return new Map();

    const children = categories.filter((c) => c.parentSlug === categorySlug);
    const schemasToMerge: AttributeField[][] =
      children.length > 0
        ? [target.schema, ...children.map((child) => resolveEffectiveSchema(child.schema, target.schema))]
        : [resolveEffectiveSchema(target.schema, bySlug.get(target.parentSlug ?? '')?.schema ?? [])];

    // De-dupe by name across the merged schemas — first occurrence wins (mirrors toMap's conflict rule).
    const merged = new Map<string, AttributeField>();
    for (const schema of schemasToMerge) {
      for (const field of schema) {
        if (!merged.has(field.name)) merged.set(field.name, field);
      }
    }
    return this.toMap([...merged.values()]);
  }

  /**
   * Forces the next resolve call to recompute from the DB instead of reusing
   * the memoized value. Called after a category schema edit (RÁFAGA 2 —
   * admin de categorías) so the change is reflected without restarting the
   * process. Only invalidates the in-memory cache of the process that runs
   * it — a multi-instance deployment would need pub/sub to reach every
   * instance — out of scope here.
   */
  invalidate(): void {
    this.cache = null;
  }

  private async loadCategories(): Promise<CategoryAttrEntry[]> {
    if (!this.cache) {
      this.cache = this.prisma.category
        .findMany({ select: { slug: true, attributeSchema: true, parent: { select: { slug: true } } } })
        .then((rows) =>
          rows.map((r) => ({
            slug: r.slug,
            parentSlug: r.parent?.slug ?? null,
            schema: (r.attributeSchema as unknown as AttributeField[]) ?? [],
          })),
        );
    }
    return this.cache;
  }

  private toMap(fields: AttributeField[]): Map<string, AttributeField['type']> {
    const types = new Map<string, AttributeField['type']>();
    for (const field of fields) {
      if (!field.filterable) continue;
      if (RESERVED_ATTRIBUTE_NAMES.has(field.name)) continue;

      const existing = types.get(field.name);
      if (existing === undefined) {
        types.set(field.name, field.type);
      } else if (existing !== field.type) {
        this.logger.warn(
          `Attribute "${field.name}" is declared with type "${existing}" in one category ` +
          `and "${field.type}" in another; keeping "${existing}" for search filtering.`,
        );
      }
    }
    return types;
  }
}
