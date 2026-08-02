/**
 * B1 — tipos y herencia del sistema de TAGS. Hermano de `category.types.ts`, no parte
 * de él: un atributo es clave→valor, un tag es pertenece/no-pertenece.
 */

/** Lo mínimo que necesita cualquier consumidor de un tag: identificarlo, filtrarlo
 *  (`slug`) y mostrarlo (`name`). Es lo que devuelven los endpoints públicos. */
export interface TagRef {
  id: string;
  slug: string;
  name: string;
}

/**
 * Tags EFECTIVOS de una categoría: los suyos MÁS los de su padre.
 *
 * UNIÓN, no override — a diferencia de `resolveEffectiveViews` y
 * `resolveEffectivePriceUnits`, donde una config propia REEMPLAZA entera la del padre.
 * Y sin pisado por nombre, a diferencia de `resolveEffectiveSchema`: aquí no puede haber
 * colisión, porque padre e hija referencian LA MISMA FILA de `Tag`. No existe el caso de
 * "la hija quiere negar un tag del padre"; si hiciera falta, se quita del padre, no se
 * inventa una lista de exclusión.
 *
 * ORDEN: propios PRIMERO, heredados después. Es el INVERSO de `resolveEffectiveSchema`,
 * y a propósito: allí el orden es de FORMULARIO (los heredados del padre contextualizan
 * antes de preguntar por lo específico), aquí es de SUGERENCIA (al etiquetar un anuncio
 * de "Coches", lo propio de coches es más relevante que lo genérico de "Vehículos").
 *
 * Mismo supuesto de 2 niveles (hoja → padre, sin abuelo) que todo lo demás, garantizado
 * por `assertParentIsRoot`.
 *
 * NOTA: no filtra por `activo`. Eso se hace en la consulta (`where: { activo: true }`),
 * que es donde el índice `[activo, orden]` puede trabajar; esta función es pura y solo
 * decide la composición y el orden.
 */
export function resolveEffectiveTags(own: TagRef[], parent: TagRef[]): TagRef[] {
  const propios = new Set(own.map((t) => t.id));
  return [...own, ...parent.filter((t) => !propios.has(t.id))];
}

/**
 * Tope de tags por anuncio cuando el ajuste `maxTagsPerListing` no está configurado.
 *
 * B1 solo lo DEFINE; quien lo usa para validar es B2 (tags en el anuncio). Cinco es un
 * número que permite describir un anuncio sin convertir la lista en un saco: pasado ese
 * punto los tags dejan de discriminar y el filtro pierde valor.
 *
 * Mismo patrón que `TICKET_REOPEN_WINDOW_DAYS`: no se siembra en el seed, "sin
 * configurar" es un estado válido y explícito que cae a esta constante.
 */
export const DEFAULT_MAX_TAGS_PER_LISTING = 5;
