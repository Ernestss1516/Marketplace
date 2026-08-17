import type { ListingType, ListingTypePolicy, ListingViewMode, PriceUnit } from '@prisma/client';

/**
 * Tope de profundidad del árbol de categorías, contando la raíz como nivel 1:
 * raíz → hija → nieta → bisnieta.
 *
 * ÚNICO SITIO donde vive el número. Lo usan la guarda de creación
 * (`AdminService.assertMaxDepth`) y el backoffice (para decidir si una fila
 * ofrece «Nueva subcategoría»). Ninguna resolución de herencia lo mira: todas
 * recorren la cadena que les da `CategoryTreeService`, sea cual sea su largo —
 * el tope acota lo que se puede CREAR, no lo que se sabe RESOLVER.
 *
 * POR QUÉ UNA CONSTANTE Y NO UN `Setting`:
 *
 *  1. La profundidad es una decisión de modelo, no un parámetro de operación.
 *     Los Setting de este repo son cosas que se tocan (cuotas, precios,
 *     interruptores de feature); esto se toca una vez cada varios años.
 *
 *  2. Un ajuste que el admin puede mover pero que el resto del sistema no
 *     respeta es peor que no tenerlo. En este repo ya hay DOS ajustes muertos
 *     —`listingExpiryDays` y `contactRequiresVerification`: declarados,
 *     sembrados, editables y con cero lectores (ver docs/mapa-categorias-y-ciclo-vida.md
 *     §4.4)—. Un tope de profundidad decorativo sería el tercero, y este sí
 *     tendría consecuencias.
 *
 *  3. BAJARLO NO ES SEGURO: las categorías que ya existan por debajo del tope
 *     nuevo quedarían sin forma de editarse ni de mostrarse. Un valor que no se
 *     puede bajar sin migrar datos no debe ofrecerse como editable.
 *
 * Mismo criterio (no el mismo nombre — `NAV_MAX_DEPTH` es de OTRO árbol, el del
 * menú, y vale 2) que `nav.types.ts`.
 *
 * SUBIRLO exige además añadir la ruta correspondiente en `apps/web`
 * (`[categoria]/[subcategoria]/…`): el frontend modela los niveles con rutas
 * explícitas a propósito, para que una URL profunda inexistente siga dando un
 * 404 REAL del router y no un 404 blando. Ver docs/diseno-profundidad-categorias.md §D.1.
 */
export const CATEGORY_MAX_DEPTH = 4;

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
 * Merges an inherited attribute schema with a category's own.
 * Own attributes override inherited ones with the same name.
 * Inherited attributes appear first; the category's own appear after.
 *
 * REDUCTOR, NO UN LÍMITE DE DOS NIVELES. Toma dos listas ya resueltas, así que
 * los llamantes lo PLIEGAN sobre la cadena de ancestros (raíz→hoja) y con eso
 * resuelve cualquier profundidad: `cadena.reduce((acc, n) => resolveEffectiveSchema(n.propio, acc), [])`.
 * El tope del árbol es `CATEGORY_MAX_DEPTH`, no una limitación de esta función.
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
 * Counts how many attributes in an (already-resolved, own+inherited) schema
 * have `flag` set (cardAttribute or wideCardAttribute), broken down by which
 * listing type they apply to. An attribute without `appliesTo` applies to
 * BOTH and is counted in both buckets — this is why the card-attribute limit
 * cannot be validated as one global count: 4 attributes flagged for the
 * standard card, 2 PRODUCT-only + 2 SERVICE-only, is valid (no listing ever
 * sees more than 2), while 3 PRODUCT-only (or 3 with no appliesTo) is not.
 */
export function countAttributesByType(
  schema: AttributeField[],
  flag: 'cardAttribute' | 'wideCardAttribute',
): Record<ListingType, number> {
  const counts: Record<ListingType, number> = { PRODUCT: 0, SERVICE: 0 };
  for (const f of schema) {
    if (!f[flag]) continue;
    if (!f.appliesTo || f.appliesTo.includes('PRODUCT')) counts.PRODUCT++;
    if (!f.appliesTo || f.appliesTo.includes('SERVICE')) counts.SERVICE++;
  }
  return counts;
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
 * contradict" rule. REDUCTOR, igual que resolveEffectiveSchema: se PLIEGA sobre
 * la cadena de ancestros, así que una restricción del bisabuelo alcanza al
 * bisnieto. La guarda que rechaza la contradicción al escribir es
 * AdminService.assertPolicyConsistentWithAncestors, que compara contra lo
 * HEREDADO (no contra el valor propio del padre).
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
 * MODERACIÓN PREVIA (M1) — ¿los anuncios de esta categoría pasan por revisión?
 *
 * ES UN OR, Y ESO LO DICE TODO: el pliegue es MONÓTONO. Una vez que un ancestro
 * dice «revisar», ningún descendiente puede desdecirlo — no hay valor que se
 * pueda poner abajo para que el resultado vuelva a ser `false`. Un descendiente
 * sólo puede AÑADIR revisión a una rama que no la tenía.
 *
 * ES LA DIFERENCIA CON LAS OTRAS CUATRO RESOLUCIONES, y es deliberada:
 * `allowedViews` y `allowedPriceUnits` son override (el hijo manda),
 * `attributeSchema` es fusión y `allowedListingType` es restricción con
 * contradicción prohibida. Aquí no hay override posible.
 *
 * POR QUÉ, en una frase: los dos errores no cuestan lo mismo. Marcar de más
 * cuesta revisar trabajo que no hacía falta, y se ve —la cola crece—. Aflojar de
 * menos cuesta publicar sin revisar lo que se había decidido revisar, y eso no lo
 * ve nadie hasta que hay un problema. Cuando el error tiene consecuencias
 * asimétricas, el diseño se inclina al lado barato.
 *
 * REDUCTOR, igual que las demás: se pliega sobre la cadena raíz→hoja, así que la
 * marca del bisabuelo alcanza al bisnieto. Que suba por TODA la cadena y no sólo
 * un nivel es el riesgo R1 de la profundidad, y por eso el fixture de 4 niveles
 * tiene un caso para ello.
 */
export function resolveEffectiveRequiresReview(
  own: boolean,
  parentEffective: boolean,
): boolean {
  return own || parentEffective;
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
 * ancestor configures anything. REDUCTOR, igual que resolveEffectiveSchema: se
 * pliega sobre la cadena, así que gana el primer ancestro configurado mirando
 * desde la hoja hacia arriba, esté al nivel que esté.
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

/**
 * Global fallback for price formats (RP.1): only one-time payment. Reproduces
 * the behavior of every listing created before this ráfaga — all of them were,
 * de facto, one-time payments — so a category that configures nothing keeps
 * behaving exactly as it did. Deliberately NOT "every unit": that would make
 * "per hour" selectable in categories where it makes no sense without an admin
 * ever asking for it.
 */
export const DEFAULT_ALLOWED_PRICE_UNITS: PriceUnit[] = ['ONE_TIME'];

/**
 * Resolves which price formats a category effectively offers (RP.1).
 * `allowedPriceUnits: []` means "not configured" — an own config always fully
 * REPLACES the parent's (no per-unit merging), same criterion as
 * resolveEffectiveViews. Falls back to DEFAULT_ALLOWED_PRICE_UNITS when neither
 * this category nor its parent configures anything.
 *
 * Note this is deliberately NOT modeled on resolveEffectivePolicy: a listing
 * TYPE policy is hierarchical (a child may only narrow what its parent allows),
 * whereas price formats are not — "Inmobiliaria" may allow [ONE_TIME] (sales)
 * while its child "Alquiler de pisos" allows [PER_MONTH]. The child offering
 * something the parent does not is legitimate here, not a contradiction, so
 * there is no parent-consistency guard to mirror either.
 *
 * REDUCTOR, igual que resolveEffectiveSchema/resolveEffectiveViews: se pliega
 * sobre la cadena de ancestros. El tope del árbol es CATEGORY_MAX_DEPTH, y quien
 * lo aplica al crear es AdminService.assertMaxDepth.
 */
export function resolveEffectivePriceUnits(
  own: PriceUnit[],
  parentEffective: PriceUnit[] | null,
): PriceUnit[] {
  if (own.length > 0) return own;
  return parentEffective ?? DEFAULT_ALLOWED_PRICE_UNITS;
}

/** Whether an already-resolved list of price formats allows a given one. */
export function isPriceUnitAllowed(allowed: PriceUnit[], unit: PriceUnit): boolean {
  return allowed.includes(unit);
}
