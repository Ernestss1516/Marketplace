import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SearchService, VARIABLE_ATTRIBUTE_KEYS } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Buscar anuncios',
    description:
      'Búsqueda de texto completo con filtros y facetas resuelta por Meilisearch. ' +
      'Devuelve datos suficientes para pintar la tarjeta sin consultar la base de datos. ' +
      'Los atributos variables de categoría (brand, fuel, gearbox, sqm, rooms, gender, size…) ' +
      'se pueden usar como filtros adicionales. Cualquier parámetro no declarado en el DTO ' +
      'es rechazado con 400.',
  })
  @ApiOkResponse({
    description:
      '{ hits: ResumenAnuncio[], totalHits: number, page: number, hitsPerPage: number, facets?: Record<string, Record<string, number>> }',
  })
  async search(@Query() dto: SearchQueryDto) {
    // Extract validated variable attributes from the DTO.
    // VARIABLE_ATTRIBUTE_KEYS is the single source of truth shared with the
    // service; adding a new attribute there and in the DTO is all that's needed.
    const attributes: Record<string, string | number | boolean> = {};
    for (const key of VARIABLE_ATTRIBUTE_KEYS) {
      const value = dto[key];
      if (value !== undefined) {
        attributes[key] = value as string | number | boolean;
      }
    }

    const result = await this.searchService.search({
      q: dto.q,
      categorySlug: dto.category,
      type: dto.type,
      condition: dto.condition,
      priceType: dto.priceType,
      minPrice: dto.minPrice,
      maxPrice: dto.maxPrice,
      province: dto.province,
      city: dto.city,
      sort: dto.sort,
      page: dto.page,
      hitsPerPage: dto.hitsPerPage,
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
      // Geo proximity: all three params required. radius converts km → metres.
      // When geo is set and sort is absent the service orders by _geoPoint distance.
      // Documents without _geo are excluded by Meilisearch's _geoRadius filter.
      ...(dto.lat != null && dto.lng != null && dto.radius != null
        ? { geo: { lat: dto.lat, lng: dto.lng, radiusMeters: dto.radius * 1000 } }
        : {}),
    });

    // Normalize flat Meilisearch documents to the ListingSummary contract expected by the
    // frontend. Variable attributes are spread at the top level in the index document but
    // the frontend card reads them from `listing.attributes` (same as the Postgres path).
    const hits = result.hits.map((hit) => {
      const attrs: Record<string, unknown> = {};
      for (const key of VARIABLE_ATTRIBUTE_KEYS) {
        const v = (hit as Record<string, unknown>)[key];
        if (v !== undefined) attrs[key] = v;
      }
      // Spread the raw Meilisearch document first so every stored field
      // (categoryPath, _geo, boostScore, …) is preserved, then override
      // the fields that need normalisation and inject the nested attributes
      // object that the frontend ListingCard expects.
      return {
        ...(hit as Record<string, unknown>),
        status: 'ACTIVE' as const,
        thumbnailUrl: (hit.thumbnailUrl as string | null) ?? undefined,
        attributes: attrs,
      };
    });

    return {
      hits,
      totalHits: result.totalHits ?? 0,
      page: result.page ?? dto.page ?? 1,
      hitsPerPage: result.hitsPerPage ?? dto.hitsPerPage ?? 24,
      facets: result.facetDistribution,
    };
  }
}
