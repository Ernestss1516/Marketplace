import type { ListingType } from '@prisma/client';
import {
  filterSchemaByType,
  resolveEffectiveSchema,
  resolveLinkedOptions,
  type AttributeField,
} from './category.types';
import type { CategoryNode } from './category-tree.service';

/**
 * LOS VALIDADORES DE ATRIBUTOS, EN UN SOLO SITIO. Fichero PURO: sin Nest, sin
 * DI, sin Prisma. Mismo molde que `category.types.ts`, del que sale todo lo que
 * necesita.
 *
 * POR QUÉ SE EXTRAJERON (deuda que anotó M2). Vivían como tres métodos `private`
 * de `ListingsService`, un servicio con doce dependencias. Cuando el comando de
 * medición (`gate-impact-report`) necesitó contar cuántos anuncios incumplen,
 * instanciar aquel servicio habría traído colas, Redis y Meilisearch a un script
 * de lectura — así que los REPLICÓ, y dejó escrito el riesgo: «si alguien cambia
 * el original y no esto, el número deja de ser el real». Ahora hay TRES
 * consumidores (el alta/edición, la puerta y la medición) y una sola
 * implementación: si diverge, diverge para todos a la vez, que es lo que se ve.
 *
 * DEVUELVEN DATOS, NO EXCEPCIONES, y eso es lo que permite los tres usos:
 *
 *  · `ListingsService` lanza al PRIMER problema, con su texto de siempre (los
 *    envoltorios de allí componen exactamente el mismo mensaje que antes).
 *  · La PUERTA los quiere TODOS a la vez: un anuncio marcado puede incumplir
 *    tres cosas, y descubrirlas de una en una convierte el aviso en un juego de
 *    adivinanzas (decisión D-motivos del diseño).
 *  · La MEDICIÓN sólo cuenta, sin lanzar nada.
 *
 * EL ORDEN IMPORTA y se conserva: requeridos → claves desconocidas → valores →
 * vinculados. Es el orden en el que `create()` los llamaba, así que el PRIMER
 * problema que ve un alta es el mismo de antes, con el mismo texto y el mismo
 * 422.
 *
 * EL SCHEMA CONTRA EL QUE SE VALIDA también sale de aquí (`applicableSchemaFor`),
 * y por el mismo motivo. Son dos pasos —plegar la cadena y filtrar por el tipo
 * del anuncio— que hay que hacer EN ESE ORDEN y SIEMPRE LOS DOS: quien pliegue y
 * no filtre exigirá a un producto los requeridos de un servicio, y quien filtre
 * sin plegar no verá lo que el anuncio hereda del abuelo. Con 2 niveles el
 * segundo error era invisible; con N no lo es, y la defensa contra él es la de
 * siempre en este repo: que haya un solo sitio donde se hace.
 */

export type AttributeIssueCode =
  /** Un campo `required` del schema que el anuncio no trae. */
  | 'ATTRIBUTE_REQUIRED_MISSING'
  /** Una clave guardada que el schema ya no reconoce (huérfana). */
  | 'ATTRIBUTE_UNKNOWN'
  /** Valor fuera de las opciones, o del tipo equivocado. */
  | 'ATTRIBUTE_VALUE_INVALID'
  /** Un select vinculado con valor pero sin su padre elegido. */
  | 'ATTRIBUTE_LINKED_PARENT_MISSING'
  /** Un select vinculado cuyo valor no pertenece al del padre. */
  | 'ATTRIBUTE_LINKED_INVALID';

/** Un problema concreto, siempre atado a UN atributo por su `name`. */
export interface AttributeIssue {
  code: AttributeIssueCode;
  /** El `name` del atributo — es lo que deja al editor señalar el campo. */
  field: string;
  /** Texto de cara al usuario, en español. */
  message: string;
}

type Attributes = Record<string, unknown>;

/**
 * El schema EFECTIVO Y APLICABLE de un anuncio: la herencia de toda su cadena
 * raíz→hoja, filtrada por el tipo (producto/servicio) del anuncio.
 *
 * `cadena` viene de `CategoryTreeService` — el único lector de la jerarquía — y
 * el pliegue es el mismo reductor de siempre: cada nivel sobreescribe a sus
 * ancestros.
 */
export function applicableSchemaFor(
  cadena: readonly CategoryNode[],
  type: ListingType,
): AttributeField[] {
  const efectivo = cadena.reduce<AttributeField[]>(
    (acc, nodo) => resolveEffectiveSchema(nodo.attributeSchema, acc),
    [],
  );
  return filterSchemaByType(efectivo, type);
}

/**
 * TODO lo que un anuncio incumple contra la configuración VIGENTE de su
 * categoría. Es la pregunta que hace la puerta al revalidar a fondo, y la que
 * responde si un anuncio marcado ya se puede desmarcar.
 *
 * Sin `deltaKeys`: se mira el bag completo. Aquí no hay edición que acotar —
 * justamente se está preguntando si el anuncio, tal y como está guardado, sigue
 * siendo válido.
 */
export function attributeIssuesFor(
  cadena: readonly CategoryNode[],
  type: ListingType,
  attributes: Attributes,
): AttributeIssue[] {
  return collectAttributeIssues(attributes, applicableSchemaFor(cadena, type));
}

/**
 * Campos `required` del schema que el bag no trae.
 *
 * Devuelve NOMBRES (no issues) porque `ListingsService.validateRequired` los
 * junta en un solo mensaje —«Atributos requeridos faltantes: a, b»— y ese texto
 * se conserva letra por letra. La puerta usa `collectAttributeIssues`, que sí
 * emite uno por campo.
 *
 * Ojo con el criterio: es PRESENCIA de la clave (`hasOwnProperty`), no valor
 * verdadero. Una clave presente con `''` o `null` cumple el requerido y luego se
 * la mira `invalidValueIssues`. Es el comportamiento de siempre y cambiarlo
 * rompería anuncios existentes.
 */
export function missingRequiredNames(attributes: Attributes, schema: AttributeField[]): string[] {
  return schema
    .filter((f) => f.required && !Object.prototype.hasOwnProperty.call(attributes, f.name))
    .map((f) => f.name);
}

/** Claves del bag que el schema no reconoce. Huérfanas: sobran, no faltan. */
export function unknownAttributeKeys(attributes: Attributes, schema: AttributeField[]): string[] {
  const byName = new Set(schema.map((f) => f.name));
  return Object.keys(attributes).filter((k) => !byName.has(k));
}

/**
 * Opciones de select PLANO y tipo de dato.
 *
 * Los vinculados (`dependsOn`) se saltan aquí — los mira `linkedSelectIssues`,
 * que necesita resolver el valor del padre. La asimetría es deliberada y viene
 * del original.
 */
export function invalidValueIssues(
  attributes: Attributes,
  schema: AttributeField[],
): AttributeIssue[] {
  const issues: AttributeIssue[] = [];
  for (const field of schema) {
    if (field.dependsOn) continue;
    if (!(field.name in attributes)) continue;
    const value = attributes[field.name];
    if (value === null || value === undefined || value === '') continue;

    if (field.type === 'select') {
      if (!(field.options ?? []).includes(String(value))) {
        issues.push({
          code: 'ATTRIBUTE_VALUE_INVALID',
          field: field.name,
          message: `"${String(value)}" no es una opción válida de "${field.label}".`,
        });
      }
    } else if (field.type === 'number') {
      const n = typeof value === 'number' ? value : Number(value);
      if (typeof value === 'boolean' || value === '' || Number.isNaN(n)) {
        issues.push({
          code: 'ATTRIBUTE_VALUE_INVALID',
          field: field.name,
          message: `"${field.label}" debe ser un número.`,
        });
      }
    } else if (field.type === 'boolean') {
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        issues.push({
          code: 'ATTRIBUTE_VALUE_INVALID',
          field: field.name,
          message: `"${field.label}" debe ser verdadero/falso.`,
        });
      }
    }
    // text: cualquier string vale, sin refuerzo adicional.
  }
  return issues;
}

/**
 * Selects vinculados (`dependsOn` / `optionsByParent`): el valor de un campo
 * dependiente tiene que pertenecer al valor elegido en su padre.
 *
 * `deltaKeys` — sólo lo pasa `update()`: si ni el campo ni su padre cambiaron en
 * esa petición, el par no se re-valida aunque ya fuera inválido (grandfathering).
 * La puerta y la medición NO lo pasan: ahí se mira el bag entero, que es lo que
 * significa «revalidar a fondo».
 */
export function linkedSelectIssues(
  attributes: Attributes,
  schema: AttributeField[],
  deltaKeys?: Set<string>,
): AttributeIssue[] {
  const issues: AttributeIssue[] = [];
  for (const field of schema) {
    if (!field.dependsOn) continue;
    if (deltaKeys && !deltaKeys.has(field.name) && !deltaKeys.has(field.dependsOn)) continue;

    const rawValue = attributes[field.name];
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    const value = String(rawValue);

    const parentRaw = attributes[field.dependsOn];
    if (parentRaw === undefined || parentRaw === null || parentRaw === '') {
      const parentLabel = schema.find((f) => f.name === field.dependsOn)?.label ?? field.dependsOn;
      issues.push({
        code: 'ATTRIBUTE_LINKED_PARENT_MISSING',
        field: field.name,
        message: `"${field.label}" requiere seleccionar primero "${parentLabel}".`,
      });
      continue;
    }

    if (!resolveLinkedOptions(field, String(parentRaw)).includes(value)) {
      issues.push({
        code: 'ATTRIBUTE_LINKED_INVALID',
        field: field.name,
        message: `"${value}" no es una opción válida de "${field.label}" para el valor elegido.`,
      });
    }
  }
  return issues;
}

/**
 * TODOS los problemas del bag contra el schema, de una vez y en el orden de
 * siempre. Es lo que consumen la puerta (para sus `reasons`) y la medición.
 *
 * `schema` tiene que llegar ya PLEGADO (la herencia de la cadena) y ya FILTRADO
 * por el tipo del anuncio. Ver la nota de cabecera.
 */
export function collectAttributeIssues(
  attributes: Attributes,
  schema: AttributeField[],
): AttributeIssue[] {
  const byName = new Map(schema.map((f) => [f.name, f]));

  const faltan: AttributeIssue[] = missingRequiredNames(attributes, schema).map((name) => ({
    code: 'ATTRIBUTE_REQUIRED_MISSING' as const,
    field: name,
    // Uno por campo, y no el mensaje agregado del alta: aquí el objetivo es que
    // el vendedor pueda ir campo por campo corrigiendo.
    message: `Falta "${byName.get(name)?.label ?? name}", que es obligatorio.`,
  }));

  const huerfanos: AttributeIssue[] = unknownAttributeKeys(attributes, schema).map((name) => ({
    code: 'ATTRIBUTE_UNKNOWN' as const,
    field: name,
    message: `"${name}" ya no es un atributo de esta categoría.`,
  }));

  return [
    ...faltan,
    ...huerfanos,
    ...invalidValueIssues(attributes, schema),
    ...linkedSelectIssues(attributes, schema),
  ];
}
