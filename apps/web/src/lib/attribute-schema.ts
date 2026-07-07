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
