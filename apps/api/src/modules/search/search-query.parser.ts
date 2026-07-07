import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SearchQueryDto } from './dto/search-query.dto';
import type { AttributeField } from '../categories/category.types';

// Fixed query params handled by SearchQueryDto. Anything else is either a
// category-derived variable attribute (validated against the dynamically
// resolved name -> type map) or unknown (rejected), replacing the previous
// static forbidNonWhitelisted whitelist for the attribute section.
export const CORE_SEARCH_QUERY_KEYS = new Set([
  'q', 'category', 'type', 'condition', 'priceType', 'minPrice', 'maxPrice',
  'province', 'city', 'sort', 'page', 'hitsPerPage', 'lat', 'lng', 'radius',
]);

export interface ParsedSearchQuery {
  dto: SearchQueryDto;
  attributes: Record<string, string | number | boolean>;
}

function coerceAttributeValue(
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
export async function parseSearchQuery(
  raw: Record<string, unknown>,
  attributeTypes: ReadonlyMap<string, AttributeField['type']>,
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

  return { dto, attributes };
}
