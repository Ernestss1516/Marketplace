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
 * El bag de atributos que se manda al backend, a partir de los valores del formulario.
 *
 * Los formularios manejan TODO como cadena (es lo que devuelve un `<input>`); esto le
 * devuelve su tipo a cada valor según el schema, y **descarta los vacíos**: un atributo
 * opcional sin rellenar no debe viajar como `''`, que el backend rechazaría por no ser
 * un número ni una opción válida.
 *
 * VIVÍA DUPLICADA, palabra por palabra, en `PublicarWizard.tsx` y en `EditarForm.tsx`.
 * Se extrae al añadir el TERCER consumidor —el modo edición del backoffice (2a)— en vez
 * de escribir la tercera copia: es el molde de P3a con las validaciones del backend, y
 * el mismo motivo (tres copias divergen, y la que divergiría sin que nadie lo notara es
 * la del backoffice). Su sitio es éste, junto a `filterSchemaByType`, que es la función
 * con la que siempre se usa emparejada.
 *
 * OJO AL USARLA: el backend guarda `attributes` por REEMPLAZO COMPLETO del jsonb, así
 * que hay que pasarle el schema ENTERO del anuncio —el efectivo de su cadena de
 * categorías, filtrado por tipo—, no un subconjunto. Con un subconjunto, lo que no
 * aparezca se borra.
 */
export function buildAttributes(
  values: Record<string, string>,
  schema: AttributeSchema[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of schema) {
    const val = values[field.name];
    if (val === undefined || val === '') continue;
    if (field.type === 'number') result[field.name] = Number(val);
    else if (field.type === 'boolean') result[field.name] = val === 'true';
    else result[field.name] = val;
  }
  return result;
}

/**
 * Los errores de cliente de un bag de atributos: requeridos vacíos y selects vinculados
 * cuyo valor ya no encaja con el de su padre. Devuelve `{ nombre: mensaje }`, que es
 * justo lo que `StepAtributos` espera en su prop `errors`.
 *
 * **POR QUÉ ESTA VALIDACIÓN VIVE EN EL CLIENTE Y NO SÓLO EN EL SERVIDOR.** El backend
 * valida `attributes` sobre el bag MEZCLADO (lo guardado + el delta) pero lo ESCRIBE por
 * reemplazo completo. Con las dos cosas a la vez, vaciar un atributo REQUERIDO se cuela:
 * el formulario no lo manda (un valor vacío no viaja), la validación lo recupera de lo
 * guardado y lo da por bueno, y la escritura lo borra. El anuncio queda inválido, en
 * silencio, y el aviso de `needsRevalidation` le llega al VENDEDOR.
 *
 * Es un hueco del backend —afecta igual al camino del dueño, que sólo está a salvo
 * porque su formulario frena antes— y está anotado como tal en `estado-tecnico.md`. Esta
 * función es lo que hace que el backoffice frene EXACTAMENTE donde frena el dueño, que
 * es la promesa de P3a, mientras el hueco de abajo se cierra aparte.
 *
 * TERCERA COPIA EVITADA: la regla estaba escrita, palabra por palabra, dentro del
 * `validateSection` de `PublicarWizard.tsx` y del de `EditarForm.tsx`.
 */
export function attributeErrors(
  values: Record<string, string>,
  schema: AttributeSchema[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of schema) {
    if (field.required) {
      const val = values[field.name];
      if (!val || val === '') errors[field.name] = `${field.label} es obligatorio.`;
    }
    // Selects vinculados: si el campo tiene valor, debe ser una opción válida para el
    // valor actual de su padre (la UI ya lo impide en el caso normal —deshabilitado
    // hasta elegir el padre, opciones acotadas—, pero el estado puede quedar obsoleto
    // tras idas y venidas).
    if (field.dependsOn) {
      const val = values[field.name];
      if (val) {
        const parentVal = values[field.dependsOn];
        if (!resolveLinkedOptions(field, parentVal).includes(val)) {
          errors[field.name] = `${field.label} no es válido para el valor elegido.`;
        }
      }
    }
  }
  return errors;
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
  // Solo los tres campos que de verdad lee, en vez del `AttributeSchema` entero: el
  // panel de filtros (A3) le pasa una vista reducida del atributo que no tiene por qué
  // arrastrar `filterable`/`required`, y esta era la única razón por la que no podía
  // reutilizar la MISMA función que el wizard. Sin cambio de comportamiento.
  field: Pick<AttributeSchema, 'dependsOn' | 'options' | 'optionsByParent'>,
  parentValue: string | undefined,
): string[] {
  if (!field.dependsOn) return field.options ?? [];
  if (parentValue === undefined) return [];
  return field.optionsByParent?.[parentValue] ?? [];
}
