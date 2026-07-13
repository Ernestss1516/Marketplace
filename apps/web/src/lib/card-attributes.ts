import type { Category, AttributeSchema, CardAttributeDef, ListingType } from '@/types';
import type { CardAttributeMap } from '@/components/anuncios/CardAttributesContext';

// RÁFAGA 3 — mismas reglas de default que resolveShowLabel/resolveShowUnit en
// apps/api/src/modules/categories/category.types.ts. Duplicada aquí porque
// buildCardAttributeMapFromSchema (más abajo) construye su mapa a partir del
// `attributeSchema` crudo (no de una lista pre-resuelta por el backend, como sí
// hace el árbol de /categories) — sin un paquete compartido entre api/web, es
// la misma duplicación que ya existía para "cardAttribute"/"unit".
function toAttrDef(f: AttributeSchema): CardAttributeDef {
  return {
    key: f.name,
    label: f.label,
    ...(f.unit ? { unit: f.unit } : {}),
    showLabel: f.showLabel ?? !f.unit,
    showUnit: f.showUnit ?? true,
    ...(f.appliesTo ? { appliesTo: f.appliesTo } : {}),
  };
}

/**
 * Filters attribute defs to the ones that apply to a listing's type (ATRIBUTOS
 * EN CARD — respetar producto/servicio). Absent `appliesTo` on a def = applies
 * to both (same default used everywhere else — filterSchemaByType en el backend,
 * AttributeSchemaEditor en el admin). Absent `listingType` (no debería pasar una
 * vez que `type` se selecciona en todos los caminos de datos, pero es defensivo)
 * = mostrar todo en vez de ocultar, porque no se puede saber qué aplica.
 */
export function filterDefsByListingType(
  defs: CardAttributeDef[],
  listingType: ListingType | undefined,
): CardAttributeDef[] {
  if (!listingType) return defs;
  return defs.filter((d) => !d.appliesTo || d.appliesTo.includes(listingType));
}

/**
 * Builds a slug→cardAttributes map from the full category tree returned by GET /categories.
 * Cubre home, búsqueda, /[categoria] y vendedor — CUALQUIER página que pueda mostrar
 * listings de más de una categoría (incluida una categoría padre, cuyo listado mezcla
 * anuncios de sus hijas vía categoryPath de Meilisearch) necesita el árbol completo:
 * una entrada por categoría (padres Y hojas), no solo la de la categoría de la URL —
 * ver «RÁFAGA 3, bug de atributos en /[categoria]» en docs/estado-tecnico.md.
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
 * (as returned by GET /categories/:slug). Usado SOLO en /anuncio/[slug] (ficha +
 * relacionados): ahí todos los listings — el actual y sus relacionados — comparten
 * SIEMPRE la misma categoría (relacionados se piden filtrando por
 * `listing.category.slug`), así que un mapa de una sola entrada es correcto — no
 * hay riesgo de mezcla de categorías como si lo había en /[categoria] (ver
 * buildCardAttributeMap). NO USAR esto para una página que pueda listar más de
 * una categoría — para eso, `getCategories()` + buildCardAttributeMap/
 * buildWideCardAttributeMap/buildFullAttributeMap con el árbol completo.
 */
export function buildCardAttributeMapFromSchema(
  slug: string,
  schema: AttributeSchema[],
): CardAttributeMap {
  const defs: CardAttributeDef[] = schema.filter((f) => f.cardAttribute).map(toAttrDef);
  return defs.length ? { [slug]: defs } : {};
}

/**
 * Builds a slug→wideCardAttributes map from the full category tree (RÁFAGA 2 —
 * vista ampliada). Up to 6 per category, independent of buildCardAttributeMap's
 * 2-attribute compact set. Mismo criterio de "árbol completo" que buildCardAttributeMap.
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
