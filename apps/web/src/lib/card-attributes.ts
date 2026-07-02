import type { Category, AttributeSchema, CardAttributeDef } from '@/types';
import type { CardAttributeMap } from '@/components/anuncios/CardAttributesContext';

/**
 * Builds a slug→cardAttributes map from the full category tree returned by GET /categories.
 * Covers home, búsqueda and vendedor pages that receive the full tree.
 */
export function buildCardAttributeMap(categories: Category[]): CardAttributeMap {
  const map: CardAttributeMap = {};
  for (const cat of categories) {
    if (cat.cardAttributes?.length) map[cat.slug] = cat.cardAttributes;
    for (const child of cat.children ?? []) {
      if (child.cardAttributes?.length) map[child.slug] = child.cardAttributes;
    }
  }
  return map;
}

/**
 * Builds a slug→allAttributes map from the full category tree.
 * Unlike buildCardAttributeMap, this includes ALL attribute definitions (not just
 * the 1-2 card-highlighted ones). Used in the map detail panel to show the complete
 * attribute set of a listing without an extra API fetch.
 */
export function buildFullAttributeMap(categories: Category[]): CardAttributeMap {
  const map: CardAttributeMap = {};
  for (const cat of categories) {
    const attrs = cat.allAttributes ?? cat.cardAttributes;
    if (attrs?.length) map[cat.slug] = attrs;
    for (const child of cat.children ?? []) {
      const childAttrs = child.allAttributes ?? child.cardAttributes;
      if (childAttrs?.length) map[child.slug] = childAttrs;
    }
  }
  return map;
}

/**
 * Builds a single-entry map from a category's effective attributeSchema
 * (as returned by GET /categories/:slug). Used on single-category pages
 * (categoría, ficha) that already have the schema without fetching the full tree.
 */
export function buildCardAttributeMapFromSchema(
  slug: string,
  schema: AttributeSchema[],
): CardAttributeMap {
  const defs: CardAttributeDef[] = schema
    .filter((f) => f.cardAttribute)
    .map((f) => ({ key: f.name, label: f.label, ...(f.unit ? { unit: f.unit } : {}) }));
  return defs.length ? { [slug]: defs } : {};
}
