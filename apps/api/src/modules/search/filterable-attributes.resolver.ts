import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AttributeField } from '../categories/category.types';

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

/**
 * Resolves the set of category-attribute names that should be filterable in
 * search, derived from `Category.attributeSchema` instead of a hardcoded
 * list. Replaces the previous VARIABLE_ATTRIBUTE_KEYS constant.
 */
@Injectable()
export class FilterableAttributesResolver {
  private readonly logger = new Logger(FilterableAttributesResolver.name);
  private cache: Promise<Map<string, AttributeField['type']>> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Flat union of filterable attribute names across every category (parents
   * and leaves alike) — this answers "which keys exist as filters in the
   * whole system", not "which schema applies to one category", so it does
   * NOT need resolveEffectiveSchema's parent/child merge.
   *
   * Computed once per process lifetime and memoized. A category schema edit
   * via the admin backoffice takes effect on the next process restart, same
   * as the previous hardcoded-list behaviour.
   */
  async getAttributeTypes(): Promise<ReadonlyMap<string, AttributeField['type']>> {
    if (!this.cache) this.cache = this.resolve();
    return this.cache;
  }

  /**
   * Forces the next getAttributeTypes() call to recompute from the DB instead
   * of reusing the memoized value. Called after a category schema edit
   * (RÁFAGA 2 — admin de categorías) so the change is reflected without
   * restarting the process. Only invalidates the in-memory cache of the
   * process that runs it — see the multi-instance caveat in SearchService.
   */
  invalidate(): void {
    this.cache = null;
  }

  private async resolve(): Promise<Map<string, AttributeField['type']>> {
    const categories = await this.prisma.category.findMany({
      select: { attributeSchema: true },
    });

    const types = new Map<string, AttributeField['type']>();
    for (const category of categories) {
      const schema = (category.attributeSchema as unknown as AttributeField[]) ?? [];
      for (const field of schema) {
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
    }
    return types;
  }
}
