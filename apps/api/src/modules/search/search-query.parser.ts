import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SearchQueryDto } from './dto/search-query.dto';
import type { AttributeField } from '../categories/category.types';

// Fixed query params handled by SearchQueryDto. Anything else is either a
// category-derived variable attribute (validated against the dynamically
// resolved name -> type map) or unknown (rejected), replacing the previous
// static forbidNonWhitelisted whitelist for the attribute section.
export const CORE_SEARCH_QUERY_KEYS = new Set([
  'q', 'category', 'type', 'condition', 'priceType', 'priceUnit', 'minPrice', 'maxPrice',
  'province', 'city', 'sort', 'page', 'hitsPerPage', 'lat', 'lng', 'radius',
  // V-4 — «solo con vídeo». Reservado aquí para que NO se trate como atributo de
  // categoría: `hasVideo` es global (cualquier anuncio puede tenerlo), no pertenece a
  // ninguna categoría, así que la validación scoped-por-categoría no le aplica — el
  // mismo caso que `tags`.
  'conVideo',
  // B2 lo reservó (para que no se tratara como atributo de categoría) y B3 lo activó:
  // ahora `SearchQueryDto.tags` existe, así que en vez de chocar con
  // `forbidNonWhitelisted` se parsea como CSV.
  //
  // Estar aquí es lo que lo mantiene FUERA de la validación scoped-por-categoría de
  // los atributos, y eso es exactamente lo que hace falta: un atributo pertenece a una
  // categoría (de ahí el 400 anti-leak cross-categoría de RÁFAGA 1), pero un tag es
  // vocabulario GLOBAL — `?tags=diesel` sin categoría es una búsqueda legítima.
  'tags',
]);

/**
 * A4 — sufijos de RANGO. `km_min=50000&km_max=150000` filtra por intervalo; la
 * igualdad de siempre (`km=120000`) se conserva intacta.
 *
 * Se eligen sufijos sobre la clave base (y no un formato tipo `km=50000..150000`)
 * porque encajan con lo que ya hay: cada filtro sigue siendo UN query param plano,
 * así que el panel de filtros, `filter-carry` y las URLs compartidas no necesitan
 * entender ninguna sintaxis nueva.
 */
const RANGE_SUFFIXES = { _min: 'min', _max: 'max' } as const;
type RangeBound = (typeof RANGE_SUFFIXES)[keyof typeof RANGE_SUFFIXES];

/** Rango pedido para un atributo numérico. Cualquiera de los dos extremos puede
 *  faltar: `km_min` suelto es "50000 o más". */
export interface AttributeRange {
  min?: number;
  max?: number;
}

/** Parte `km_min` en `{ base: 'km', bound: 'min' }`. `null` si no lleva sufijo. */
function splitRangeKey(key: string): { base: string; bound: RangeBound } | null {
  for (const [suffix, bound] of Object.entries(RANGE_SUFFIXES) as [string, RangeBound][]) {
    if (key.length > suffix.length && key.endsWith(suffix)) {
      return { base: key.slice(0, -suffix.length), bound };
    }
  }
  return null;
}

export interface ParsedSearchQuery {
  dto: SearchQueryDto;
  attributes: Record<string, string | number | boolean>;
  /** A4 — rangos por atributo numérico, ya validados y coaccionados a número. Van
   *  aparte de `attributes` a propósito: esos son filtros de IGUALDAD y estos de
   *  intervalo, y mezclarlos obligaría al service a adivinar cuál es cuál. */
  attributeRanges: Record<string, AttributeRange>;
  /** The map actually used to validate/coerce `attributes` — reused by the controller
   * for hit normalisation so both steps agree on which keys are attributes. */
  attributeTypes: ReadonlyMap<string, AttributeField['type']>;
}

export function coerceAttributeValue(
  kind: AttributeField['type'],
  rawValue: unknown,
  key: string,
  errors: string[],
): string | number | boolean | undefined {
  switch (kind) {
    case 'number': {
      const n = Number(rawValue as string);
      if (!Number.isFinite(n)) {
        errors.push(`${key} must be a number`);
        return undefined;
      }
      return n;
    }
    case 'boolean':
      // Mirrors the previous @Transform(({value}) => value === 'true' || value === true)
      // decorator: any value other than the literal string "true" (or boolean
      // true) coerces to false — it never rejects the request.
      return rawValue === 'true' || rawValue === true;
    case 'text':
    case 'select':
    default:
      if (typeof rawValue !== 'string') {
        errors.push(`${key} must be a string`);
        return undefined;
      }
      return rawValue;
  }
}

/**
 * Splits the raw query into the fixed core fields — validated exactly as
 * before, via the same ValidationPipe class/options used globally in
 * main.ts — and the category-derived variable attributes, validated against
 * the dynamically resolved name -> type map. Both error sources are merged
 * into a single 400, mirroring the combined-message behaviour of the
 * previous single-DTO whitelist validation.
 */
/**
 * Resolves which attribute names are valid for this request. Receives a
 * category slug (undefined for /busqueda general, which accepts any
 * category's attribute) and returns the map to validate `attributes`
 * against — plain function so the caller decides global vs.
 * per-category (FilterableAttributesResolver.getAttributeTypes vs.
 * getAttributeTypesForCategory).
 */
export type AttributeTypesResolver = (
  categorySlug: string | undefined,
) => Promise<ReadonlyMap<string, AttributeField['type']>>;

export async function parseSearchQuery(
  raw: Record<string, unknown>,
  resolveAttributeTypes: AttributeTypesResolver,
): Promise<ParsedSearchQuery> {
  const coreRaw: Record<string, unknown> = {};
  const restRaw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    (CORE_SEARCH_QUERY_KEYS.has(key) ? coreRaw : restRaw)[key] = value;
  }

  const errors: string[] = [];
  let dto: SearchQueryDto | undefined;
  try {
    const corePipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    dto = (await corePipe.transform(coreRaw, { type: 'query', metatype: SearchQueryDto })) as SearchQueryDto;
  } catch (err) {
    if (err instanceof BadRequestException) {
      const response = err.getResponse() as { message?: string[] | string };
      errors.push(
        ...(Array.isArray(response.message) ? response.message : [String(response.message ?? err.message)]),
      );
    } else {
      throw err;
    }
  }

  // `condition` (estado de conservación) no aplica a SERVICE — un servicio no tiene
  // estado de conservación, igual que un producto no tiene "especialidad". Sin este
  // guard, `type=SERVICE&condition=NEW` no daba error: simplemente devolvía 0
  // resultados en silencio (ningún SERVICE tiene `condition` seteado por el wizard),
  // indistinguible de "esta búsqueda concreta no tiene resultados".
  if (dto?.type === 'SERVICE' && dto?.condition) {
    errors.push('condition no aplica a anuncios de tipo SERVICE');
  }

  // Scope attribute validation to the requested category (RÁFAGA 1 — fixes the
  // cross-category leak, e.g. /coches?rooms=3 silently accepting "pisos"' attribute).
  // Falls back to the raw (unvalidated) category string if the core DTO failed to
  // parse, so attribute errors still make sense even when category itself is malformed.
  const categorySlug = dto?.category ?? (typeof coreRaw.category === 'string' ? coreRaw.category : undefined);
  const attributeTypes = await resolveAttributeTypes(categorySlug);

  const attributes: Record<string, string | number | boolean> = {};
  const attributeRanges: Record<string, AttributeRange> = {};

  for (const [key, rawValue] of Object.entries(restRaw)) {
    // La clave LITERAL manda: un atributo que de verdad se llame `km_min` sigue
    // filtrando por igualdad como cualquier otro. Que eso no pueda convivir con un
    // `km` numérico lo garantiza el guard de la config de admin
    // (assertNoRangeSuffixCollision), no este parser.
    const kind = attributeTypes.get(key);
    if (kind) {
      const coerced = coerceAttributeValue(kind, rawValue, key, errors);
      if (coerced !== undefined) attributes[key] = coerced;
      continue;
    }

    // A4 — ¿es el extremo de un rango sobre un atributo numérico?
    const rango = splitRangeKey(key);
    if (rango) {
      const baseKind = attributeTypes.get(rango.base);
      if (baseKind === undefined) {
        // Ni el sufijo ni la base existen aquí: mismo 400 que cualquier param
        // desconocido. Es la defensa anti-leak cross-categoría de RÁFAGA 1, que el
        // rango no debe abrir por la puerta de atrás.
        errors.push(`property ${key} should not exist`);
        continue;
      }
      if (baseKind !== 'number') {
        // Un rango sobre un `select` o un `text` no significa nada. Se rechaza en vez
        // de ignorarlo en silencio: ignorarlo devolvería resultados sin el filtro que
        // el usuario cree haber aplicado.
        errors.push(`${key} solo aplica a atributos numéricos (${rango.base} es ${baseKind})`);
        continue;
      }
      const n = Number(rawValue as string);
      if (!Number.isFinite(n)) {
        errors.push(`${key} must be a number`);
        continue;
      }
      (attributeRanges[rango.base] ??= {})[rango.bound] = n;
      continue;
    }

    errors.push(`property ${key} should not exist`);
  }

  // Un rango invertido es un error del cliente, no una búsqueda sin resultados:
  // devolver 0 hits en silencio esconde el fallo justo cuando hay que verlo.
  for (const [base, rango] of Object.entries(attributeRanges)) {
    if (rango.min != null && rango.max != null && rango.min > rango.max) {
      errors.push(`${base}_min (${rango.min}) no puede ser mayor que ${base}_max (${rango.max})`);
    }
  }

  if (errors.length > 0 || !dto) {
    throw new BadRequestException(errors);
  }

  return { dto, attributes, attributeRanges, attributeTypes };
}
