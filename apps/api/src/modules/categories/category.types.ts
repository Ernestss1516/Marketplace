export interface AttributeField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  unit?: string;
  options?: string[];
  filterable: boolean;
  required: boolean;
  cardAttribute?: boolean;
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
