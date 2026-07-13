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

/**
 * Builds a single-entry map with ALL attribute definitions from a category's
 * effective attributeSchema — used by the map's detail panel on /[categoria]
 * (RÁFAGA 2, mapa ahora disponible ahí), mismo criterio que buildFullAttributeMap
 * para el árbol completo.
 */
export function buildFullAttributeMapFromSchema(
  slug: string,
  schema: AttributeSchema[],
): CardAttributeMap {
  const defs: CardAttributeDef[] = schema
    .map((f) => ({ key: f.name, label: f.label, ...(f.unit ? { unit: f.unit } : {}) }));
  return defs.length ? { [slug]: defs } : {};
}

/**
 * Builds a slug→wideCardAttributes map from the full category tree (RÁFAGA 2 —
 * vista ampliada en /busqueda, que mezcla categorías). Up to 6 per category,
 * independent of buildCardAttributeMap's 2-attribute compact set.
 */
export function buildWideCardAttributeMap(categories: Category[]): CardAttributeMap {
  const map: CardAttributeMap = {};
  for (const cat of categories) {
    if (cat.wideCardAttributes?.length) map[cat.slug] = cat.wideCardAttributes;
    for (const child of cat.children ?? []) {
      if (child.wideCardAttributes?.length) map[child.slug] = child.wideCardAttributes;
    }
  }
  return map;
}

/**
 * Builds a single-entry wideCardAttributes map from a category's effective
 * attributeSchema (GET /categories/:slug) — used on /[categoria] in vista ampliada.
 */
export function buildWideCardAttributeMapFromSchema(
  slug: string,
  schema: AttributeSchema[],
): CardAttributeMap {
  const defs: CardAttributeDef[] = schema
    .filter((f) => f.wideCardAttribute)
    .map((f) => ({ key: f.name, label: f.label, ...(f.unit ? { unit: f.unit } : {}) }));
  return defs.length ? { [slug]: defs } : {};
}
