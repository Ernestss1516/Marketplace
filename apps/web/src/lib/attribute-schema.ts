import type { AttributeSchema, ListingType } from '@/types';

/**
 * Narrows a resolved attribute schema to the fields that apply to a given
 * listing type — espejo del filterSchemaByType del backend
 * (category.types.ts). Un campo sin `appliesTo` aplica a ambos tipos.
 *
 * type === '' (aún no decidido, p. ej. antes de completar StepDatos) no
 * filtra nada — evita ocultar campos prematuramente en un punto del wizard
 * donde el tipo todavía no es conocido.
 */
export function filterSchemaByType(
  schema: AttributeSchema[],
  type: ListingType | '',
): AttributeSchema[] {
  if (!type) return schema;
  return schema.filter((f) => !f.appliesTo || f.appliesTo.includes(type));
}

/**
 * Resolves the valid options for a (possibly linked) select field given the
 * current value of its parent field (if any) — espejo del
 * resolveLinkedOptions del backend (category.types.ts). Plain selects (sin
 * `dependsOn`) devuelven directamente sus `options`. Un select vinculado sin
 * valor de padre, o con un valor de padre sin entrada, resuelve a lista
 * vacía — el wizard trata eso como "aún no seleccionable".
 */
export function resolveLinkedOptions(
  field: AttributeSchema,
  parentValue: string | undefined,
): string[] {
  if (!field.dependsOn) return field.options ?? [];
  if (parentValue === undefined) return [];
  return field.optionsByParent?.[parentValue] ?? [];
}
