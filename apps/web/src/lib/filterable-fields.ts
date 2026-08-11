import type { AttributeSchema, Category } from '@/types';
import { conDescendientes, recorrerArbol } from '@/lib/category-tree';

/**
 * A3 — QUÉ FILTROS DE ATRIBUTO PINTA EL PANEL, y con qué forma.
 *
 * El cambio de eje de A3 vive aquí: hasta ahora la lista de secciones del panel la
 * dictaba el RESULTADO (las facetas que devolvía Meilisearch), así que un atributo
 * marcado `filterable: true` sin ni un solo anuncio que lo tuviera **no aparecía
 * nunca** (F6). El backend ya hacía su parte —marcar un atributo como filtrable basta
 * para que llegue como faceta—, pero el frontend solo veía pares `clave cruda → conteo`
 * y no podía pintar lo que no viniera en esa lista.
 *
 * Ahora la lista la dicta la CONFIG: estas funciones resuelven, para el ámbito de la
 * página, la definición efectiva de cada atributo filtrable. Las facetas pasan a ser
 * solo los CONTEOS de cada valor.
 */

/** Lo que el panel necesita saber para pintar un filtro. Subconjunto de `AttributeSchema`. */
export interface AttributeFieldView {
  name: string;
  label: string;
  type: AttributeSchema['type'];
  unit?: string;
  options?: string[];
  dependsOn?: string;
  optionsByParent?: Record<string, string[]>;
}

/** Ordena por label para que el panel no dependa del orden de llegada. */
function porLabel(a: AttributeFieldView, b: AttributeFieldView): number {
  return a.label.localeCompare(b.label, 'es');
}

/** Deduplica por `name` conservando la primera aparición — mismo criterio que
 *  `FilterableAttributesResolver.toMap` en el backend (gana la primera). */
function dedupe(campos: AttributeFieldView[]): AttributeFieldView[] {
  const vistos = new Map<string, AttributeFieldView>();
  for (const campo of campos) {
    if (!vistos.has(campo.name)) vistos.set(campo.name, campo);
  }
  return [...vistos.values()].sort(porLabel);
}

/** Un `CardAttributeDef` del árbol → la vista que consume el panel. `key` es el nombre. */
function desdeArbol(attr: NonNullable<Category['allAttributes']>[number]): AttributeFieldView {
  return {
    name: attr.key,
    label: attr.label,
    // El árbol no traía `type` hasta A3; si faltara (respuesta de una API vieja), se
    // trata como texto, que es el control más inocuo: un input libre nunca inventa
    // opciones que no existen.
    type: attr.type ?? 'text',
    ...(attr.unit !== undefined ? { unit: attr.unit } : {}),
    ...(attr.options !== undefined ? { options: attr.options } : {}),
    ...(attr.dependsOn !== undefined ? { dependsOn: attr.dependsOn } : {}),
    ...(attr.optionsByParent !== undefined ? { optionsByParent: attr.optionsByParent } : {}),
  };
}

/** Un `AttributeSchema` (el crudo de `GET /categories/:slug`) → la vista del panel. */
function desdeSchema(f: AttributeSchema): AttributeFieldView {
  return {
    name: f.name,
    label: f.label,
    type: f.type,
    ...(f.unit !== undefined ? { unit: f.unit } : {}),
    ...(f.options !== undefined ? { options: f.options } : {}),
    ...(f.dependsOn !== undefined ? { dependsOn: f.dependsOn } : {}),
    ...(f.optionsByParent !== undefined ? { optionsByParent: f.optionsByParent } : {}),
  };
}

/**
 * Filtros de la BÚSQUEDA GLOBAL (/busqueda sin categoría): la unión de lo filtrable de
 * todo el árbol. Es el mismo criterio que usa el backend ahí
 * (`FilterableAttributesResolver.getAttributeTypes`, unión de todas las categorías):
 * sin categoría que acote, cualquier atributo de cualquier categoría es un filtro
 * legítimo.
 */
export function filterableFieldsForTree(tree: Category[]): AttributeFieldView[] {
  // PROFUNDIDAD N — RÁFAGA 3: TODO el árbol, no «raíces + un nivel». Sin
  // categoría que acote, un atributo de cualquier profundidad es un filtro
  // legítimo; con el recorrido de dos niveles, los de nivel 3-4 desaparecían del
  // panel de /busqueda.
  const todos = recorrerArbol(tree).flatMap((cat) => cat.allAttributes ?? []);
  return dedupe(todos.filter((a) => a.filterable).map(desdeArbol));
}

/**
 * Filtros de UNA CATEGORÍA.
 *
 * `schema` es el efectivo (propio + heredado) que devuelve `GET /categories/:slug`, así
 * que para una HOJA ya está todo. Para una categoría CON DESCENDENCIA hace falta además
 * la unión con lo filtrable de toda ella, replicando la regla del backend
 * (`getAttributeTypesForCategory`): navegarla filtra por `categoryPath = slug`, que
 * mezcla los anuncios de toda la subcadena, así que un atributo de un descendiente
 * —"combustible" mirando /vehiculos— es un filtro legítimo ahí.
 *
 * PROFUNDIDAD N — RÁFAGA 3: eran «las hijas»; ahora son TODOS los descendientes. Con 2
 * niveles las dos cosas coincidían; con 4, mirando una raíz se perdían los atributos de
 * nietos y bisnietos, y el panel ofrecía menos filtros de los que la búsqueda acepta.
 *
 * `tree` puede venir vacío (fallo de la API): entonces solo se usa el schema, que es lo
 * que ya se tenía.
 */
export function filterableFieldsForCategory(
  schema: AttributeSchema[],
  tree: Category[],
  categorySlug: string,
): AttributeFieldView[] {
  const propios = schema.filter((f) => f.filterable).map(desdeSchema);

  // `slice(1)` — el primero es la propia categoría, que ya viene en `schema`.
  const deDescendientes = conDescendientes(tree, categorySlug)
    .slice(1)
    .flatMap((d) => (d.allAttributes ?? []).filter((a) => a.filterable).map(desdeArbol));

  // Los propios primero: si un descendiente redefine un atributo del ancestro, manda la
  // definición de la categoría que se está mirando.
  return dedupe([...propios, ...deDescendientes]);
}
