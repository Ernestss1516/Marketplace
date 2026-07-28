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
]);

export interface ParsedSearchQuery {
  dto: SearchQueryDto;
  attributes: Record<string, string | number | boolean>;
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
  for (const [key, rawValue] of Object.entries(restRaw)) {
    const kind = attributeTypes.get(key);
    if (!kind) {
      errors.push(`property ${key} should not exist`);
      continue;
    }
    const coerced = coerceAttributeValue(kind, rawValue, key, errors);
    if (coerced !== undefined) attributes[key] = coerced;
  }

  if (errors.length > 0 || !dto) {
    throw new BadRequestException(errors);
  }

  return { dto, attributes, attributeTypes };
}
