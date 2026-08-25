import { Controller, Get, Headers, Ip, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SearchService, type SearchParams } from './search.service';
import { FilterableAttributesResolver } from './filterable-attributes.resolver';
import { parseSearchQuery } from './search-query.parser';
import { SponsoredAdsService } from '../sponsored-ads/sponsored-ads.service';
import { ReviewsService } from '../reviews/reviews.service';
import { TagsService } from '../tags/tags.service';
import { ImpressionsService } from '../impressions/impressions.service';

// Posición fija de inserción entre los hits, convención documentada en H6.1.
const SPONSORED_AD_POSITION = 3;

// Tamaño del bloque "Promocionados" (política de ordenación C, RÁFAGA 1). Solo
// página 1 — igual que los patrocinados, un bloque de promoción no tiene sentido
// en la página 7 de resultados.
const FEATURED_BLOCK_SIZE = 4;

/**
 * ROTACIÓN — R2. EL ORDEN DEL ANILLO. Es PROPIO del bloque y no el que haya pedido el
 * usuario, y ésa es la decisión que hace posible el turno (diseño D5).
 *
 * Con el orden del usuario, la partición en grupos cambiaría con cada ordenación distinta y
 * con cada edición de precio; y bajo el orden por defecto de una categoría
 * (`publishedAt:desc`, y `publishedAt` es INMUTABLE) volveríamos exactamente al problema de
 * origen: los mismos cuatro para siempre. Un turno necesita un orden estable y propio.
 *
 * LO QUE ESTO CUESTA, DICHO CLARO: el bloque ya NO va ordenado como la lista. Buscando por
 * «precio: menor a mayor», la vitrina puede enseñar un coche de 30.000 € encima de una lista
 * que empieza en 500 €. Es el precio de que la vitrina sea un TURNO y no un ranking.
 *
 * LO QUE NO CAMBIA: el bloque sigue respetando TODOS los filtros (`baseParams` entero). Lo
 * que cambia es el ORDEN dentro del bloque, nunca QUÉ anuncios son elegibles.
 */
const FEATURED_RING_SORT = 'featuredStartsAt:asc' as const;

/**
 * ROTACIÓN — R2. La duración de la ventana: cada cuánto cambia el turno.
 *
 * 15 MINUTOS (diseño D1) es el equilibrio entre las dos cosas que se pelean: más corta
 * reparte antes (el ciclo con N=50 dura 3 h 15 en vez de 13 h) pero hace que el bloque cambie
 * mientras alguien navega; más larga es más estable pero condena a los últimos del anillo a
 * esperar. Quince minutos es más que una sesión de navegación típica, así que el visitante
 * corriente ve UN bloque estable de principio a fin.
 *
 * SE PUEDE AJUSTAR POR ENTORNO, no por `Setting`: la búsqueda no toca Postgres
 * (`apps/api/CLAUDE.md`), así que leer un ajuste de base de datos en la ruta más caliente del
 * sitio está descartado. Mismo molde que `MEILI_INDEX_NAME` en search.service.ts.
 *
 * LA GUARDA NO ES PARANOIA: un `FEATURED_ROTATION_WINDOW_MINUTES=0` (o un valor con una coma
 * mal puesta) daría una ventana de cero segundos y `Math.floor(x / 0) = Infinity`, y de ahí
 * `Infinity % grupos = NaN`: el bloque se quedaría vacío en todo el sitio por un typo en un
 * `.env`. Ante cualquier valor que no sea un número positivo, se usa el de por defecto.
 */
const VENTANA_POR_DEFECTO_MINUTOS = 15;
const ventanaPedida = Number(process.env.FEATURED_ROTATION_WINDOW_MINUTES);
export const FEATURED_ROTATION_WINDOW_SECONDS =
  (Number.isFinite(ventanaPedida) && ventanaPedida > 0 ? ventanaPedida : VENTANA_POR_DEFECTO_MINUTOS) * 60;

/**
 * ROTACIÓN — R2. Qué grupo del anillo le toca a la ventana en curso (1-indexado, como las
 * páginas de Meilisearch).
 *
 * EL CURSOR ES EL RELOJ, Y NO HAY MÁS ESTADO QUE ESE. La ventana se deriva del epoch UTC
 * (`floor(ahora / duración)`), así que dos instancias del backend calculan el mismo turno sin
 * hablar entre ellas, no hay contador que resetear, no hay cron, y dada una hora y un número
 * de grupos la salida es única — es decir, reproducible cuando haya que depurarla.
 *
 * EL `+ 1` NO ES COSMÉTICO: las páginas de Meilisearch empiezan en 1. Sin él, una de cada
 * `grupos` ventanas pediría la página 0 y el bloque saldría vacío o desalineado.
 *
 * Con `grupos <= 1` no hay nada que rotar (todos los destacados caben en el bloque) y la
 * respuesta es siempre la página 1 — el caso mayoritario del sitio.
 */
export function grupoDeLaVentana(
  ahoraMs: number,
  grupos: number,
  ventanaSegundos: number = FEATURED_ROTATION_WINDOW_SECONDS,
): number {
  if (!Number.isFinite(grupos) || grupos <= 1) return 1;
  const ventana = Math.floor(ahoraMs / 1000 / ventanaSegundos);
  return (ventana % grupos) + 1;
}

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly attributesResolver: FilterableAttributesResolver,
    private readonly sponsoredAdsService: SponsoredAdsService,
    private readonly reviewsService: ReviewsService,
    // B3 — el catálogo de tags activos, para descartar slugs viejos de la query.
    private readonly tagsService: TagsService,
    // ESTADÍSTICAS A1 — el contador de «veces listado».
    //
    // VIVE AQUÍ, EN EL CONTROLADOR, Y NO EN `SearchService`. No es una preferencia de
    // capa: `SearchService.search()` lo llaman TAMBIÉN las alertas
    // (`alerts.service.ts:55` y `:128`, `alert-matching.service.ts:64` — una consulta
    // por anuncio y alerta, dentro de un worker). Contar ahí convertiría cada barrido de
    // alertas en una lluvia de impresiones que ningún usuario ha visto nunca.
    //
    // Este controlador es el único sitio por el que pasa una petición de búsqueda de una
    // PERSONA, que es la definición de la métrica.
    private readonly impressions: ImpressionsService,
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
      'solo en página 1 — bloque "Promocionados"; política de ordenación C). ' +
      'El bloque ROTA: los destacados vigentes se turnan por ventanas de 15 min, así que ' +
      'dos peticiones en ventanas distintas devuelven grupos distintos y con el tiempo salen ' +
      'todos. Su orden es propio (por fecha de concesión), no el `sort` pedido — los FILTROS ' +
      'sí se respetan enteros.',
  })
  @ApiOkResponse({
    description:
      '{ hits: ResumenAnuncio[], featured: ResumenAnuncio[], totalHits: number, page: number, hitsPerPage: number, facets?: Record<string, Record<string, number>> }',
  })
  async search(
    @Query() rawQuery: Record<string, unknown>,
    // A1 — la identidad del visitante REENVIADA por el BFF. `/busqueda` y
    // `/[categoria]` son Server Components: sin esta cabecera, la IP que ve Nest es la
    // del servidor de Next y TODOS los visitantes serían el mismo. Ver
    // `ImpressionsService.resolveVisitorKey` y `apps/web/src/lib/visitor.ts`.
    @Headers('x-visitor-hash') visitorHash: string | undefined,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    const { dto, attributes, attributeRanges, attributeTypes } = await parseSearchQuery(rawQuery, (categorySlug) =>
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

    // B3 — ETIQUETAS. Se descarta EN SILENCIO cualquier slug que no esté en el catálogo
    // activo, en vez de devolver 400.
    //
    // Es deliberadamente distinto del trato que reciben los atributos, y la diferencia
    // no es de rigor sino de qué significa cada cosa:
    //  · un atributo ajeno a la categoría es un ERROR DE ÁMBITO (`/coches?rooms=3`) — el
    //    400 de RÁFAGA 1 existe para que no se filtre en silencio a través de
    //    categorías, y NO se relaja aquí;
    //  · un tag desconocido es casi siempre un ENLACE VIEJO: alguien compartió
    //    `?tags=diesel` y meses después un admin desactivó ese tag. Romper esa búsqueda
    //    con un 400 castiga al visitante por una decisión de administración que no vio.
    //
    // La alternativa —pasarlo tal cual a Meilisearch— daría 0 resultados, que es peor:
    // "no hay nada" y "ese filtro ya no existe" no son lo mismo, y el usuario no puede
    // distinguirlos. Descartándolo ve el resto de la búsqueda.
    //
    // El panel no queda incoherente: solo pinta chips de tags que están en la lista de
    // disponibles, así que un tag descartado tampoco aparece marcado.
    const tagsPedidos = dto.tags ?? [];
    // El catálogo se resuelve UNA vez (cacheado en Redis), no una por slug.
    const activos = tagsPedidos.length ? await this.tagsService.activeTagSlugs() : null;
    const tags = activos ? tagsPedidos.filter((slug) => activos.has(slug)) : [];

    const baseParams: SearchParams = {
      q: dto.q,
      categorySlug: dto.category,
      type: dto.type,
      condition: dto.condition,
      priceType: dto.priceType,
      priceUnit: dto.priceUnit,
      minPrice: dto.minPrice,
      maxPrice: dto.maxPrice,
      province: dto.province,
      city: dto.city,
      // V-4 — sólo viaja si se pidió. `undefined` no añade cláusula, así que una búsqueda
      // sin el filtro es byte a byte la de siempre.
      ...(dto.conVideo ? { onlyWithVideo: true } : {}),
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
      // A4 — rangos numéricos (km_min/km_max). Van aparte de `attributes` porque son
      // filtros de intervalo, no de igualdad; el service emite >= / <= con ellos.
      ...(Object.keys(attributeRanges).length > 0 ? { attributeRanges } : {}),
      // B3 — ya filtrados contra el catálogo activo (ver arriba). Se omite la clave si
      // no queda ninguno, para que la petición sea idéntica a una sin `?tags=`.
      ...(tags.length > 0 ? { tags } : {}),
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

    let hits = result.hits.map((hit) => this.normalizeHit(hit, allAttributeNames));

    // ── BLOQUE "PROMOCIONADOS" — EL TURNO DE ESTA VENTANA (ROTACIÓN R2) ─────────
    //
    // Los destacados que además cumplen los filtros actuales, en una consulta APARTE con los
    // mismos filtros + boostScore=1 — mismo molde que el patrocinado de abajo. Solo página 1.
    // NO se restan de `hits`/`totalHits`: siguen apareciendo también en su posición natural
    // dentro de la lista (se repiten a propósito — el bloque es la vitrina de pago, la lista
    // es la lista real; ver auditoría RÁFAGA 0).
    //
    // LO QUE R2 CAMBIA, Y POR QUÉ. Hasta aquí el bloque eran «los 4 primeros del orden
    // pedido», y con el orden por defecto de una categoría esa clave es `publishedAt`, que no
    // cambia nunca: el bloque estaba CONGELADO. Quien destacaba un anuncio antiguo caía bajo
    // el corte desde el primer segundo del periodo que había pagado y no aparecía jamás —con
    // 50 destacados en una categoría, 46 no veían la vitrina nunca (auditoría, hallazgo H5).
    //
    // Ahora el conjunto se recorre por TURNOS: se ordena por el anillo (FEATURED_RING_SORT),
    // se parte en grupos de 4, y la ventana del reloj dice qué grupo sale. Cada destacado sale
    // un grupo por ciclo, sin excepción; su cuota es 4/N del tiempo, que es toda la que puede
    // haber cuando hay 4 huecos y N candidatos.
    //
    // EL COSTE: DOS consultas como mucho, y la segunda SÓLO cuando hay más de 4 destacados
    // compitiendo —es decir, sólo donde el problema existe—. Con N ≤ 4 (el caso mayoritario
    // del sitio) esto cuesta exactamente lo que costaba antes: una.
    let featured: Array<Record<string, unknown>> = [];
    if ((dto.page ?? 1) === 1) {
      // UN solo instante para las dos cosas que dependen del reloj (la vigencia y la
      // ventana). Leerlo dos veces abriría la puerta a que una petición comprobase la
      // vigencia en una ventana y pidiera el turno de la siguiente.
      const ahoraMs = Date.now();

      const anillo: SearchParams = {
        ...baseParams,
        onlyBoosted: true,
        // El caducado no ocupa turno aunque el cron de las 03:00 no haya pasado todavía.
        boostedActiveAt: Math.floor(ahoraMs / 1000),
        // El orden del anillo, NO `dto.sort` — ver FEATURED_RING_SORT.
        sort: FEATURED_RING_SORT,
        hitsPerPage: FEATURED_BLOCK_SIZE,
      };

      // Consulta A: el primer grupo y, de paso, cuántos grupos tiene el ciclo. `totalPages`
      // viene del conteo exhaustivo que Meilisearch hace en modo `page`/`hitsPerPage`.
      const grupoInicial = await this.searchService.search({ ...anillo, page: 1 });
      const grupos = grupoInicial.totalPages ?? 1;
      const turno = grupoDeLaVentana(ahoraMs, grupos);

      // Consulta B: sólo si el turno NO es el grupo que ya tenemos en la mano.
      const grupoDelTurno =
        turno === 1 ? grupoInicial : await this.searchService.search({ ...anillo, page: turno });

      featured = grupoDelTurno.hits.map((hit) => this.normalizeHit(hit, allAttributeNames));
    }

    // Escaparate RÁFAGA 4 — media VERIFICADA del vendedor, en una sola consulta
    // agrupada por los sellerId distintos de hits+featured (antes de mezclar el
    // patrocinado, que no tiene sellerId). Medido: ver ReviewsService.getRatingSummaries
    // y estado-tecnico.md ("Escaparate — RÁFAGA 4") — ruido frente al resto de la
    // petición, de ahí on-the-fly en vez de tocar el documento de Meilisearch
    // (que habría exigido reindexar TODOS los anuncios de un vendedor en cada
    // review nueva, un coste de propagación muy distinto al de sellerName/trusted,
    // que casi nunca cambian).
    hits = await this.enrichWithSellerRating(hits);
    featured = await this.enrichWithSellerRating(featured);

    // ── ESTADÍSTICAS A1 — «VECES LISTADO» ───────────────────────────────────────
    //
    // EL CONJUNTO SERVIDO, deduplicado por id: `hits` ∪ `featured`. La unión y no la
    // suma porque el bloque «Promocionados» SE REPITE dentro de `hits` a propósito
    // (ver el comentario de arriba): contarlos por separado daría dos impresiones al
    // mismo anuncio en la misma respuesta, que por definición es una.
    //
    // SE CALCULA AQUÍ, ANTES DE INYECTAR EL PATROCINADO, y eso es lo que hace que «el
    // patrocinado no cuenta» sea estructural en vez de una condición que alguien pueda
    // borrar: cuando se construye este conjunto, el patrocinado todavía no está en
    // `hits`. El filtro de `__sponsored` es el segundo cinturón, por si un día se
    // reordena este bloque. (Y hay un tercero, en el volcado: `SponsoredAd` no es un
    // `Listing`, así que su id no casaría con el `JOIN "Listing"`.)
    const servedListingIds = [
      ...new Set(
        [...hits, ...featured]
          .filter((hit) => hit.__sponsored !== true)
          .map((hit) => hit.id)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];

    // SIN `await`, Y NO SE PUEDE PONER: `recordServedResults` devuelve `void`. La
    // búsqueda no espera al contador ni paga su latencia; si Redis está caído, la
    // impresión se pierde y la búsqueda responde igual (fail-open).
    this.impressions.recordServedResults({
      listingIds: servedListingIds,
      forwardedVisitorHash: visitorHash,
      ip,
      userAgent,
      query: rawQuery,
    });

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

  /**
   * Escaparate RÁFAGA 4 — una sola consulta agrupada por los sellerId
   * distintos de esta página (nunca N+1 por hit). `average: null` (0
   * verificadas) es la señal de "Nuevo" que consume el frontend.
   */
  private async enrichWithSellerRating(
    hits: Array<Record<string, unknown>>,
  ): Promise<Array<Record<string, unknown>>> {
    const sellerIds = [...new Set(hits.map((h) => h.sellerId).filter((id): id is string => typeof id === 'string'))];
    if (sellerIds.length === 0) return hits;
    const ratings = await this.reviewsService.getRatingSummaries(sellerIds);
    return hits.map((hit) => {
      const rating = typeof hit.sellerId === 'string' ? ratings.get(hit.sellerId) : undefined;
      return {
        ...hit,
        sellerRatingAverage: rating?.average ?? null,
        sellerRatingCount: rating?.count ?? 0,
      };
    });
  }
}
