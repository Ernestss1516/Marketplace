import type { ListingType, ListingTypePolicy, ListingViewMode } from '@prisma/client';

export interface AttributeField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  unit?: string;
  options?: string[];
  filterable: boolean;
  required: boolean;
  /** Shown in the compact/standard card (max 2 in the effective schema, validated at write time). */
  cardAttribute?: boolean;
  /** Shown in the wide/ampliada card (RÁFAGA 2 — max 6 in the effective schema, validated at
   * write time). Independent of `cardAttribute`: the standard card stays compact regardless
   * of how many attributes are flagged here. */
  wideCardAttribute?: boolean;
  /**
   * RÁFAGA 3 (display de atributos en card) — dos ejes independientes, no un enum de 3 modos:
   * el nombre (label) y la unidad son conceptos ortogonales, la unidad no es alternativa al
   * nombre sino parte del valor formateado. Aplica igual a card estándar y ampliada (es config
   * del atributo, no de la vista).
   *
   * showLabel: si se antepone "Label: " al valor. Default (ausente) = `!unit` — reproduce la
   * regla hardcodeada anterior a esta ráfaga ("oculta el label si hay unidad").
   */
  showLabel?: boolean;
  /** showUnit: si se añade la unidad al valor. Solo tiene efecto si el atributo tiene `unit`.
   * Default (ausente) = true. */
  showUnit?: boolean;
  /** Which listing type(s) this attribute applies to. Absent = applies to both (preserves every attribute defined before RÁFAGA 1 without touching data). */
  appliesTo?: ListingType[];
  /**
   * Name of another `select` attribute in the same effective schema whose
   * value gates this field's valid options. Single level only (no chains):
   * the parent itself must not have its own `dependsOn`. When present,
   * `options` is ignored — `optionsByParent` is the only source of truth.
   */
  dependsOn?: string;
  /** Valid options for this field, keyed by the current value of `dependsOn`'s field. Only meaningful when `dependsOn` is set. */
  optionsByParent?: Record<string, string[]>;
}

/**
 * Resolves the valid options for a (possibly linked) select field given the
 * current value of its parent field (if any). Plain selects (no `dependsOn`)
 * just return their own `options`. Linked selects with no parent value yet,
 * or a parent value with no matching entry, resolve to an empty list —
 * callers (wizard UI, backend guard) treat that as "not selectable yet".
 */
export function resolveLinkedOptions(
  field: AttributeField,
  parentValue: string | undefined,
): string[] {
  if (!field.dependsOn) return field.options ?? [];
  if (parentValue === undefined) return [];
  return field.optionsByParent?.[parentValue] ?? [];
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

/**
 * Resolves whether the attribute's label should be shown alongside its value
 * in cards (RÁFAGA 3). Absent `showLabel` defaults to `!field.unit` — this is
 * the exact rule that was hardcoded in the frontend before this ráfaga
 * ("hide the label when there's a unit"), preserved here so existing
 * attributes (which never set `showLabel`) render identically.
 */
export function resolveShowLabel(field: AttributeField): boolean {
  return field.showLabel ?? !field.unit;
}

/**
 * Resolves whether the attribute's unit should be appended to its value in
 * cards (RÁFAGA 3). Absent `showUnit` defaults to `true` — moot when the
 * attribute has no `unit` (nothing to append either way).
 */
export function resolveShowUnit(field: AttributeField): boolean {
  return field.showUnit ?? true;
}

/** Whether a resolved ListingTypePolicy allows a given listing type. */
export function isListingTypeAllowed(
  policy: ListingTypePolicy,
  type: ListingType,
): boolean {
  if (policy === 'BOTH') return true;
  return policy === (type === 'PRODUCT' ? 'PRODUCT_ONLY' : 'SERVICE_ONLY');
}

/** All three view modes with LISTA as default — the global fallback when
 * neither a category nor any of its ancestors configures views explicitly. */
export const DEFAULT_EFFECTIVE_VIEWS: EffectiveViews = {
  allowedViews: ['LISTA', 'AMPLIADA', 'MAPA'],
  defaultView: 'LISTA',
};

export interface EffectiveViews {
  allowedViews: ListingViewMode[];
  defaultView: ListingViewMode;
}

/**
 * Resolves which result views a category effectively offers (RÁFAGA 2).
 * `allowedViews: []` means "not configured" — an own config always fully
 * REPLACES the parent's (no per-view merging, unlike attribute schemas): a
 * category either defines its whole menu or inherits the parent's whole menu.
 * Falls back to DEFAULT_EFFECTIVE_VIEWS when neither this category nor its
 * parent configures anything. Same 2-level depth assumption as
 * resolveEffectiveSchema/resolveEffectivePolicy (leaf → parent only).
 */
export function resolveEffectiveViews(
  own: { allowedViews: ListingViewMode[]; defaultView: ListingViewMode | null },
  parentEffective: EffectiveViews | null,
): EffectiveViews {
  if (own.allowedViews.length > 0) {
    return { allowedViews: own.allowedViews, defaultView: own.defaultView ?? own.allowedViews[0] };
  }
  return parentEffective ?? DEFAULT_EFFECTIVE_VIEWS;
}
