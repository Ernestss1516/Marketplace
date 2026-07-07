import type { ListingType, ListingTypePolicy } from '@prisma/client';

export interface AttributeField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  unit?: string;
  options?: string[];
  filterable: boolean;
  required: boolean;
  cardAttribute?: boolean;
  /** Which listing type(s) this attribute applies to. Absent = applies to both (preserves every attribute defined before RÁFAGA 1 without touching data). */
  appliesTo?: ListingType[];
}

/**
 * Merges parent and child attribute schemas.
 * Child attributes override parent attributes with the same name.
 * Inherited attributes (parent-only) appear first; child's own appear after.
 * Depth is capped at 2 levels (leaf → parent), matching categoryPath and INDEX_INCLUDE.
 */
export function resolveEffectiveSchema(
  own: AttributeField[],
  parentSchema: AttributeField[],
): AttributeField[] {
  if (!parentSchema.length) return own;
  const ownNames = new Set(own.map((f) => f.name));
  const inherited = parentSchema.filter((f) => !ownNames.has(f.name));
  return [...inherited, ...own];
}

/**
 * Narrows an already-resolved (own + inherited) attribute schema to the
 * fields that apply to a given listing type. Composed ON TOP of
 * resolveEffectiveSchema — call that first, then filter by type. An attribute
 * without `appliesTo` applies to both types (see AttributeField.appliesTo).
 */
export function filterSchemaByType(
  schema: AttributeField[],
  type: ListingType,
): AttributeField[] {
  return schema.filter((f) => !f.appliesTo || f.appliesTo.includes(type));
}

/**
 * Merges a category's own ListingTypePolicy with its already-resolved parent
 * policy. BOTH is the neutral element: an own policy of BOTH defers entirely
 * to the parent; a parent policy of BOTH imposes no restriction, so the
 * child's own value wins. If both sides restrict to a *different* single
 * type, that is a genuine contradiction that write-time validation (category
 * create/update) must reject before it is ever persisted — this function
 * never throws; defensively it keeps the parent's value (never widening past
 * what an ancestor forbids), mirroring the "leaf can only narrow, never
 * contradict" rule. Same 2-level depth assumption as resolveEffectiveSchema
 * (leaf → parent only, no grandparent).
 */
export function resolveEffectivePolicy(
  own: ListingTypePolicy,
  parentEffective: ListingTypePolicy,
): ListingTypePolicy {
  if (own === 'BOTH') return parentEffective;
  if (parentEffective === 'BOTH') return own;
  return own === parentEffective ? own : parentEffective;
}

/** Whether a resolved ListingTypePolicy allows a given listing type. */
export function isListingTypeAllowed(
  policy: ListingTypePolicy,
  type: ListingType,
): boolean {
  if (policy === 'BOTH') return true;
  return policy === (type === 'PRODUCT' ? 'PRODUCT_ONLY' : 'SERVICE_ONLY');
}
