import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SearchService, type SearchParams } from './search.service';
import { FilterableAttributesResolver } from './filterable-attributes.resolver';
import { parseSearchQuery } from './search-query.parser';
import { SponsoredAdsService } from '../sponsored-ads/sponsored-ads.service';

// Posición fija de inserción entre los hits, convención documentada en H6.1.
const SPONSORED_AD_POSITION = 3;

// Tamaño del bloque "Promocionados" (política de ordenación C, RÁFAGA 1). Solo
// página 1 — igual que los patrocinados, un bloque de promoción no tiene sentido
// en la página 7 de resultados.
const FEATURED_BLOCK_SIZE = 4;

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly attributesResolver: FilterableAttributesResolver,
    private readonly sponsoredAdsService: SponsoredAdsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Buscar anuncios',
    description:
      'Búsqueda de texto completo con filtros y facetas resuelta por Meilisearch. ' +
      'Devuelve datos suficientes para pintar la tarjeta sin consultar la base de datos. ' +
      'Los atributos variables de categoría (brand, fuel, gearbox, sqm, rooms, gender, size…) ' +
      'se pueden usar como filtros adicionales, derivados dinámicamente del esquema de la ' +
      'categoría pedida (o de todas, si no se filtra por categoría). Cualquier parámetro no ' +
      'reconocido (ni core ni atributo filtrable de esa categoría) es rechazado con 400. ' +
      'La respuesta separa `hits` (resultados en el orden pedido, boostScore NUNCA los ' +
      'reordena) de `featured` (hasta 4 destacados que además cumplen los mismos filtros, ' +
      'solo en página 1 — bloque "Promocionados"; política de ordenación C).',
  })
  @ApiOkResponse({
    description:
      '{ hits: ResumenAnuncio[], featured: ResumenAnuncio[], totalHits: number, page: number, hitsPerPage: number, facets?: Record<string, Record<string, number>> }',
  })
  async search(@Query() rawQuery: Record<string, unknown>) {
    const { dto, attributes, attributeTypes } = await parseSearchQuery(rawQuery, (categorySlug) =>
      categorySlug
        ? this.attributesResolver.getAttributeTypesForCategory(categorySlug)
        : this.attributesResolver.getAttributeTypes(),
    );

    // BUG 1 (post-producto/servicio) — "filterable" (query param válido) y "se
    // muestra en la card" (cardAttribute/wideCardAttribute) son propiedades
    // INDEPENDIENTES de un atributo, pero normalizeHit() reconstruía
    // `hit.attributes` a partir del mapa FILTRABLE (attributeTypes) — un
    // cardAttribute marcado filterable:false (frecuente en atributos de
    // servicio: tarifa, modalidad… útiles de mostrar, no de filtrar) nunca
    // llegaba a `hit.attributes` aunque SÍ estuviera indexado en el documento
    // de Meilisearch (toDocument() indexa TODOS los atributos, sin mirar
    // filterable). Set sin restricción, mismo scope por categoría que
    // attributeTypes — no una copia del cálculo, solo sin el filtro final.
    const allAttributeNames = dto.category
      ? await this.attributesResolver.getAllAttributeNamesForCategory(dto.category)
      : await this.attributesResolver.getAllAttributeNames();

    const baseParams: SearchParams = {
      q: dto.q,
      categorySlug: dto.category,
      type: dto.type,
      condition: dto.condition,
      priceType: dto.priceType,
      minPrice: dto.minPrice,
      maxPrice: dto.maxPrice,
      province: dto.province,
      city: dto.city,
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
      // Facetas de atributo derivadas del MISMO mapa que valida los query params
      // (auditoría de filtros — antes una lista editorial fija, FACET_ATTRIBUTES,
      // desconectada de qué atributos configura realmente el admin como filterable).
      attributeFacetNames: [...attributeTypes.keys()],
      // Geo proximity: all three params required. radius converts km → metres.
      // When geo is set and sort is absent the service orders by _geoPoint distance.
      // Documents without _geo are excluded by Meilisearch's _geoRadius filter.
      ...(dto.lat != null && dto.lng != null && dto.radius != null
        ? { geo: { lat: dto.lat, lng: dto.lng, radiusMeters: dto.radius * 1000 } }
        : {}),
    };

    const result = await this.searchService.search({
      ...baseParams,
      sort: dto.sort,
      page: dto.page,
      hitsPerPage: dto.hitsPerPage,
    });

    const hits = result.hits.map((hit) => this.normalizeHit(hit, allAttributeNames));

    // H6.6 — patrocinados: solo página 1, solo con categoría, un único hueco.
    // Rompe conscientemente el invariante "búsqueda no toca Postgres", mitigado
    // con la caché Redis de SponsoredAdsService (ver apps/api/CLAUDE.md).
    if ((dto.page ?? 1) === 1 && dto.category) {
      const sponsoredAd = await this.sponsoredAdsService.resolveForSearch(dto.category);
      if (sponsoredAd) {
        hits.splice(Math.min(SPONSORED_AD_POSITION, hits.length), 0, {
          __sponsored: true,
          ...sponsoredAd,
        });
      }
    }

    // Bloque "Promocionados" (política de ordenación C, RÁFAGA 1): los destacados
    // que además cumplen los filtros actuales, en una consulta APARTE con los
    // mismos filtros + boostScore=1 — mismo molde que el patrocinado de arriba.
    // Solo página 1. NO se restan de `hits`/`totalHits`: siguen apareciendo también
    // en su posición natural dentro de la lista (se repiten a propósito — el bloque
    // es la vitrina de pago, la lista es la lista real; ver auditoría RÁFAGA 0).
    let featured: Array<Record<string, unknown>> = [];
    if ((dto.page ?? 1) === 1) {
      const featuredResult = await this.searchService.search({
        ...baseParams,
        sort: dto.sort,
        onlyBoosted: true,
        page: 1,
        hitsPerPage: FEATURED_BLOCK_SIZE,
      });
      featured = featuredResult.hits.map((hit) => this.normalizeHit(hit, allAttributeNames));
    }

    return {
      hits,
      featured,
      // totalHits refleja solo la query principal — ni el patrocinado (Postgres) ni
      // el bloque de destacados (una query aparte) deben inflar/deformar el conteo
      // real, del que depende el estado vacío ("sin resultados").
      totalHits: result.totalHits ?? 0,
      page: result.page ?? dto.page ?? 1,
      hitsPerPage: result.hitsPerPage ?? dto.hitsPerPage ?? 24,
      facets: result.facetDistribution,
    };
  }

  // Normalize a flat Meilisearch document to the ListingSummary contract expected by
  // the frontend. Variable attributes are spread at the top level in the index document
  // but the frontend card reads them from `listing.attributes` (same as the Postgres path).
  // `allAttributeNames` is UNRESTRICTED by `filterable` on purpose (bug 1, ver arriba) —
  // the frontend's own CardAttrsDisplay/WideCardAttrsDisplay already narrow this bag
  // down to whichever keys are cardAttribute/wideCardAttribute for the listing's
  // category, so surfacing every category-attribute name here (not just the
  // filterable ones) is safe and matches what /anuncio/[slug] already shows.
  private normalizeHit(
    hit: Record<string, unknown>,
    allAttributeNames: ReadonlySet<string>,
  ): Record<string, unknown> {
    const attrs: Record<string, unknown> = {};
    for (const key of allAttributeNames) {
      const v = hit[key];
      if (v !== undefined) attrs[key] = v;
    }
    // Spread the raw Meilisearch document first so every stored field
    // (categoryPath, _geo, boostScore, …) is preserved, then override
    // the fields that need normalisation and inject the nested attributes
    // object that the frontend ListingCard expects.
    return {
      ...hit,
      status: 'ACTIVE' as const,
      thumbnailUrl: (hit.thumbnailUrl as string | null) ?? undefined,
      attributes: attrs,
    };
  }
}
