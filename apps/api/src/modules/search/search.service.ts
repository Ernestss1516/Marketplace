import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Index } from 'meilisearch';
import type { Listing, ListingImage, Entitlement } from '@prisma/client';
import { MeilisearchService } from '../../infra/meilisearch/meilisearch.service';
import { FilterableAttributesResolver } from './filterable-attributes.resolver';
import {
  CategoryTreeService,
  ancestorChainIn,
  type CategoryNode,
} from '../categories/category-tree.service';

export const LISTINGS_INDEX = process.env.MEILI_INDEX_NAME ?? 'listings';

export interface ListingDocument {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  priceType: string;
  /** RP.4 — formato del precio (ONE_TIME, PER_MONTH, PER_HOUR…). Eje ortogonal a
   *  priceType: filtrable por separado. */
  priceUnit: string;
  type: string;
  condition: string | null;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  /** Slug of the leaf category followed by all ancestor slugs. Enables filtering by a parent category (X IN categoryPath). */
  categoryPath: string[];
  province: string | null;
  city: string | null;
  /**
   * Geo-coordinates for proximity search/sort.
   * Only populated when the listing has latitude + longitude set.
   */
  _geo?: { lat: number; lng: number };
  slug: string;
  thumbnailUrl: string | null;
  /** Ordered URLs of every photo (RÁFAGA 2 — carrusel en la card). Just strings, not
   * full ListingImage objects: cheap to carry in the payload (a URL is ~100 bytes vs.
   * the image bytes themselves), and the frontend only ever mounts an <Image> for the
   * one currently visible — so this does NOT mean the browser fetches every photo. */
  images: string[];
  /**
   * Vídeo Pro — SOLO el booleano, nunca la URL.
   *
   * La tarjeta lo usa para pintar un icono. Si el documento llevara la dirección, una lista
   * podría acabar descargando vídeo, que es exactamente el riesgo que el diseño evita: en
   * listas no se descarga un byte de vídeo, y eso se garantiza no dando la dirección.
   */
  hasVideo: boolean;
  sellerId: string;
  /** Public seller fields — stored in the index so the map panel avoids a per-selection fetch. */
  sellerName: string;
  sellerSlug: string;
  sellerAvatarUrl: string | null;
  /** UNIX timestamp (ms). max(publishedAt, bumpedAt) so a bump resurfaces the listing. */
  sortDate: number;
  /** UNIX timestamp (seconds). Meilisearch sorts/ranks numbers more efficiently than ISO strings. */
  publishedAt: number;
  /** 1 if listing has an active (non-revoked, non-expired) FEATURED_LISTING entitlement; 0 otherwise. */
  boostScore: 0 | 1;
  /** B2 — slugs de los tags del anuncio. Filtrable y facetable: es lo que viajará en
   *  `?tags=` y lo que alimenta la faceta. El FILTRO en sí es B3; B2 solo indexa. */
  tags: string[];
  /** B2 — nombres visibles de esos mismos tags. SOLO searchable, NUNCA filtrable:
   *  existe para que "coche automatico" en el buscador libre encuentre los anuncios
   *  con el tag "Cambio automático". Filtrar por nombre sería filtrar por un texto
   *  que el admin puede renombrar; para eso está el slug, que es inmutable. */
  tagNames: string[];
  /** Flattened category-specific attributes (brand, km, sqm, rooms, gearbox, gender, …). */
  [attribute: string]: unknown;
}

// ---------------------------------------------------------------------------
// Index configuration
// ---------------------------------------------------------------------------

const SEARCHABLE_ATTRIBUTES = [
  // Order defines relevance priority: first = most important.
  'title',
  // B2 — DESPUÉS de title y ANTES de description a propósito: un tag es vocabulario
  // controlado que alguien eligió deliberadamente, así que pesa más que la prosa
  // libre de la descripción; pero menos que el título, que es lo que el vendedor
  // decidió que ES el anuncio.
  'tagNames',
  'brand',
  'model',
  'categoryName',
  'description',
];

// ---------------------------------------------------------------------------
// Core listing fields that are always filterable regardless of category.
// The variable part of Meilisearch's filterableAttributes (brand, fuel, sqm,
// itemType, …) is resolved dynamically at startup by
// FilterableAttributesResolver from Category.attributeSchema instead of a
// hardcoded list — see onModuleInit below.
// ---------------------------------------------------------------------------
const CORE_FILTERABLE_ATTRIBUTES = [
  'id',
  'categoryId',
  'categorySlug',
  'categoryPath',
  'type',
  'condition',
  'priceType',
  // RP.4 — filtrable SIEMPRE (barato). Distinto de aparecer como faceta en el
  // panel de filtros: eso se decide por categoría, ver NATIVE_FACET_ATTRIBUTES.
  'priceUnit',
  'price',
  'province',
  'city',
  '_geo',
  'sellerId',
  // Filterable (not just sortable) so the controller can query "only boosted"
  // for the promoted block (RÁFAGA 1 — política de ordenación C).
  'boostScore',
  // B2 — filtrable SIEMPRE, como priceUnit: declararlo aquí no filtra nada por sí
  // solo, solo habilita que se PUEDA. `tagNames` NO está: es searchable y nada más.
  'tags',
  /**
   * V-4 — «SOLO CON VÍDEO». El documento llevaba `hasVideo` desde la ráfaga de
   * visualización, pero no estaba aquí: Meilisearch lo indexaba y se negaba a filtrar por
   * él. Para una ventaja Pro que se vende como diferenciador, era una vía de
   * descubrimiento cerrada — el comprador veía el indicador en las tarjetas y no tenía
   * forma de pedir sólo ésas.
   *
   * Declararlo aquí no filtra nada por sí solo: habilita que se PUEDA (mismo criterio que
   * `priceUnit` y `tags`). El filtro es opcional y sólo se aplica si alguien lo pide.
   *
   * Y SIGUE SIENDO EL BOOLEANO, nunca la dirección: `toDocument` indexa
   * `hasVideo: videoUrl != null` y la URL no entra en el documento. Poder filtrar no
   * cambia el cero-bytes-de-vídeo-en-listas.
   */
  'hasVideo',
];

const SORTABLE_ATTRIBUTES = [
  'price',
  'publishedAt',
  'sortDate',
  '_geo', // enables _geoPoint(...):asc sorting; only useful when listings carry coordinates
];

// Native (non-category-attribute) facets, always requested for guided navigation.
// The category-attribute part of the facet list is NOT hardcoded here — it used to
// be (FACET_ATTRIBUTES, an editorially curated list), which meant a category
// attribute marked filterable:true in the schema (the ONE place an admin actually
// configures this) would silently never appear as a filter in the UI unless someone
// also remembered to add its name to this constant — two sources of truth for the
// same question ("is this attribute filterable?"), and the one that mattered to the
// UI wasn't the one the admin could change. Fixed: attribute facets are now derived
// per-request from the SAME attribute-type map already resolved for query-param
// validation (FilterableAttributesResolver, scoped by category when one is given —
// see SearchParams.attributeFacetNames / SearchController). Marking an attribute
// filterable:true is now sufficient on its own for it to become a UI filter.
const NATIVE_FACET_ATTRIBUTES = [
  'categorySlug',
  'type',
  'condition',
  'priceType',
  // RP.4 — se PIDE siempre (una faceta más en la misma petición a Meilisearch,
  // sin viaje extra ni consulta a Postgres). Quién la MUESTRA se decide en el
  // frontend con la distribución devuelta: si la categoría solo admite pago
  // único, el reparto trae un único valor y FilterPanel oculta el filtro — que
  // es el objetivo de "facet visible solo con >1 formato efectivo" (§10.4),
  // conseguido sin meter una consulta de categoría en la ruta caliente de
  // búsqueda. Además se adapta al resultado real: una categoría multi-formato
  // cuyos resultados actuales sean todos PER_HOUR tampoco enseña un filtro de
  // un solo valor.
  'priceUnit',
  'province',
  // B2 — se pide ya, aunque B2 no muestre el filtro: es una faceta más en la misma
  // petición (sin viaje extra, mismo razonamiento que priceUnit) y deja los conteos
  // por tag listos para cuando B3 pinte la sección "Etiquetas". Pedir una faceta no
  // altera los hits.
  'tags',
];

// Política de ordenación C (RÁFAGA 1, 2026-07-13): boostScore NO participa en las
// ranking rules. Antes 'boostScore:desc' vivía aquí, ANTES de 'sort' — en Meilisearch
// cada regla PARTICIONA el resultado (no solo desempata), así que un destacado caro
// salía por delante de un no-destacado barato incluso ordenando por "precio: menor a
// mayor". Verificado ejecutando contra el índice real. Ahora la lista respeta siempre
// el orden pedido por el usuario (o la relevancia/recencia por defecto); la promoción
// de pago se resuelve aparte, como un bloque "Promocionados" post-query en
// SearchController (mismo molde que SponsoredAd — ver onlyBoosted en SearchParams).
const RANKING_RULES = [
  'words',
  'typo',
  'proximity',
  'attribute',
  'sort',
  'exactness',
  // Final tiebreaker: most recently published/bumped listing wins.
  // Replaces the old publishedAt:desc now that sortDate = max(publishedAt, bumpedAt).
  'sortDate:desc',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shared Prisma include for fetching a listing ready to index.
 * Exported so the indexing processor and the reindex command use el mismo
 * include — si uno cargara algo que el otro no, un mismo anuncio tendría
 * documentos distintos según por qué camino se indexara.
 *
 * PROFUNDIDAD N — YA NO CARGA `parent`, y su ausencia es la señal. Este include
 * traía el padre para que `toDocument` construyera `categoryPath`, con una nota
 * que avisaba de que sólo cubría dos niveles y de que a partir de tres habría que
 * subir por la cadena. Eso ya pasó: `categoryPath` se construye desde
 * `CategoryTreeService`, que resuelve la cadena entera. El `parent` se quedó aquí
 * sin que nadie lo leyera —un JOIN en cada indexado para nada— y su nota había
 * pasado de aviso útil a afirmación falsa.
 *
 * Si alguien vuelve a necesitar la jerarquía al indexar, la pide al servicio de
 * árbol; no la reintroduzca aquí, o habrá otra vez dos formas de responder a la
 * misma pregunta.
 */
export const INDEX_INCLUDE = {
  category: {
    select: {
      id: true,
      slug: true,
      name: true,
    },
  },
  images: { orderBy: { order: 'asc' as const } },
  // Only non-revoked FEATURED_LISTING entitlements; expiresAt is checked in toDocument()
  // because new Date() must be evaluated at index time, not at module-load time.
  entitlements: {
    where: { type: 'FEATURED_LISTING' as const, revokedAt: null },
    select: { expiresAt: true },
  },
  // Public seller fields stored in the index so the map panel can display them
  // without a per-selection API fetch.
  seller: { select: { name: true, slug: true, avatarUrl: true } },
  // B2 — tags del anuncio. Como todo lo de aquí, lo COMPARTEN el processor de
  // indexación y `pnpm reindex`: si solo uno lo cargara, un mismo anuncio tendría
  // documentos distintos según por qué camino se indexara (con tags al editarlo,
  // sin tags al reindexar en masa) — exactamente lo que advierte la nota de arriba.
  tags: { select: { tag: { select: { slug: true, name: true } } } },
} as const;

type ListingWithRelations = Listing & {
  category: { id: string; slug: string; name: string };
  images: ListingImage[];
  entitlements: Pick<Entitlement, 'expiresAt'>[];
  seller: { name: string; slug: string; avatarUrl: string | null };
  tags: { tag: { slug: string; name: string } }[];
};

export interface SearchParams {
  q?: string;
  categorySlug?: string;
  type?: string;
  condition?: string;
  priceType?: string;
  /** RP.4 — formato del precio; eje independiente de priceType. */
  priceUnit?: string;
  minPrice?: number;
  maxPrice?: number;
  province?: string;
  city?: string;
  attributes?: Record<string, string | number | boolean>;
  /** A4 — rangos por atributo numérico (`km_min`/`km_max` en la query). Separados de
   *  `attributes`, que son filtros de igualdad: un atributo puede llevar ambos. */
  attributeRanges?: Record<string, { min?: number; max?: number }>;
  /** B3 — slugs de etiqueta, ya filtrados contra el catálogo activo por el controller.
   *  Se combinan en AND: acumular etiquetas ACOTA. */
  tags?: string[];
  /**
   * Category-attribute names to request as Meilisearch facets, IN ADDITION to
   * NATIVE_FACET_ATTRIBUTES — supplied by the controller from the exact same
   * attribute-type map already resolved for query-param validation
   * (FilterableAttributesResolver.getAttributeTypes()/getAttributeTypesForCategory()),
   * so "filterable" and "facetable" are one decision, not two. Ignored when
   * `onlyBoosted` is set (the featured-block query never surfaces facets to the
   * frontend — no point paying Meilisearch's facet-computation cost for it).
   */
  attributeFacetNames?: string[];
  geo?: { lat: number; lng: number; radiusMeters: number };
  sort?: 'price:asc' | 'price:desc' | 'publishedAt:desc' | 'sortDate:desc';
  page?: number;
  hitsPerPage?: number;
  /** Confirms "is this specific listing in these results?" (B3 alert-matching Fase 2)
   * with the exact same filtering semantics as a real search — not a separate JS check. */
  listingId?: string;
  /** Restricts to boostScore=1 — used by SearchController to resolve the "Promocionados"
   * block (política de ordenación C) with the exact same filters as the main query. */
  onlyBoosted?: boolean;
  /**
   * V-4 — «solo con vídeo». OPCIONAL en el sentido fuerte: `undefined` no añade ninguna
   * cláusula, así que una búsqueda que no lo pida devuelve exactamente lo que devolvía.
   * Sólo `true` acota; `false` se trata como no pedirlo — «con vídeo o sin él» es la
   * búsqueda de siempre, no un filtro que valga la pena poder expresar.
   */
  onlyWithVideo?: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private readonly index: Index<ListingDocument>;
  // Populated in onModuleInit; used to keep the requested facets (below) a
  // subset of what's actually filterable — see the comment on FACET_ATTRIBUTES.
  private filterableAttributeNames = new Set<string>(CORE_FILTERABLE_ATTRIBUTES);

  constructor(
    private readonly meili: MeilisearchService,
    private readonly attributesResolver: FilterableAttributesResolver,
    // PROFUNDIDAD N — RÁFAGA 2: `categoryPath` se construye desde la CADENA de
    // ancestros, no desde el `parent` de un nivel del include.
    private readonly categoryTree: CategoryTreeService,
  ) {
    this.index = this.meili.client.index<ListingDocument>(LISTINGS_INDEX);
  }

  /** Ensures the index exists and its settings are up to date on every startup. */
  async onModuleInit(): Promise<void> {
    await this.applyFilterableAttributes();
  }

  /**
   * Recomputes the filterable-attribute set from FilterableAttributesResolver
   * and pushes it to Meilisearch. Shared by onModuleInit (boot) and
   * refreshFilterableAttributes() (hot refresh after an admin edits a
   * category's attributeSchema — RÁFAGA 2).
   */
  private async applyFilterableAttributes(): Promise<void> {
    try {
      const attributeTypes = await this.attributesResolver.getAttributeTypes();
      const filterableAttributes = [...CORE_FILTERABLE_ATTRIBUTES, ...attributeTypes.keys()];
      this.filterableAttributeNames = new Set(filterableAttributes);

      await this.meili.client
        .createIndex(LISTINGS_INDEX, { primaryKey: 'id' })
        .catch(() => undefined); // index already exists — that's fine
      const task = await this.index.updateSettings({
        searchableAttributes: SEARCHABLE_ATTRIBUTES,
        filterableAttributes,
        sortableAttributes: SORTABLE_ATTRIBUTES,
        rankingRules: RANKING_RULES,
        typoTolerance: {
          enabled: true,
          minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
        },
      });
      // `waitForTask`, POR EL MISMO MOTIVO QUE EN `indexListing` — y este método era el
      // ÚNICO de la clase que no lo hacía. `updateSettings` NO aplica los ajustes: los
      // ENCOLA y devuelve un `taskUid`, así que el `await` de arriba sólo espera a que
      // Meilisearch acepte el encargo, no a que lo cumpla.
      //
      // EL FALLO QUE ESTO CIERRA, y no era teórico: entre este `await` y que Meili
      // procesara la tarea había una ventana en la que el índice todavía no conocía los
      // `filterableAttributes` recién calculados. Una búsqueda que facetara por uno de
      // ellos respondía `Invalid facet distribution, attribute X is not filterable` → 500.
      // En local Meili está ocioso y gana la carrera; en un runner cargado la pierde, y
      // `search-dynamic-attributes.e2e-spec.ts` —que crea su categoría con un atributo
      // boolean y consulta justo después de `app.init()`— puso `main` en rojo.
      //
      // La prueba de que era eso: los dos errores de aquella ejecución listaban conjuntos
      // DISTINTOS de atributos filtrables. Meili estaba a media actualización.
      await this.meili.client.waitForTask(task.taskUid);
      this.logger.log('Meilisearch index settings applied.');
    } catch (err) {
      this.logger.error('Failed to configure Meilisearch index', err);
    }
  }

  /**
   * Hot refresh (RÁFAGA 2): invalidates the resolver's memoized map and
   * re-applies filterableAttributes to Meilisearch without a process restart.
   * Called from the 'refresh-filterable-attributes' BullMQ job — never
   * inline in an admin HTTP request (apps/api CLAUDE.md: heavy work goes to
   * queues). Only refreshes the in-memory state of the process that runs the
   * job; a multi-instance deployment would need pub/sub to reach every
   * instance — out of scope for R2.
   */
  async refreshFilterableAttributes(): Promise<void> {
    this.attributesResolver.invalidate();
    await this.applyFilterableAttributes();
  }

  // --------------------------------------------------------------------------
  // Write operations
  // --------------------------------------------------------------------------

  /**
   * Indexes a single listing. If the listing is not ACTIVE it is removed from
   * the index instead (handles reserve → RESERVED, sold → SOLD, etc.).
   */
  async indexListing(listing: ListingWithRelations): Promise<void> {
    if (listing.status !== 'ACTIVE') {
      await this.removeListing(listing.id);
      return;
    }
    // waitForTask ensures the document is queryable before this method returns.
    // Without it, addDocuments() is fire-and-forget: the BullMQ job completes but
    // Meilisearch may not have processed the task yet, causing tests (and real
    // users) to see a stale index for a brief but unpredictable window.
    const task = await this.index.addDocuments([
      this.toDocument(listing, await this.categoryTree.getFreshSnapshot()),
    ]);
    await this.meili.client.waitForTask(task.taskUid);
  }

  /** Removes a listing from the index. Safe to call even when the document is absent. */
  async removeListing(id: string): Promise<void> {
    await this.index.deleteDocument(id);
  }

  /**
   * Deletes every document from the index and waits for Meilisearch to finish.
   * Called by the reindex command before repopulating so that orphaned documents
   * (e.g. from a Postgres reset in dev) do not survive.
   */
  async clearAll(): Promise<void> {
    const task = await this.index.deleteAllDocuments();
    await this.meili.client.waitForTask(task.taskUid);
  }

  /**
   * Bulk-indexes an array of listings, ignoring any that are not ACTIVE.
   * Used by the reindex command and, in the future, by admin-triggered reindexing.
   */
  async reindexAll(listings: ListingWithRelations[]): Promise<void> {
    // Una sola foto del árbol para todo el lote: `categoryPath` de N niveles
    // necesita la jerarquía, y pedirla por anuncio sería una consulta por
    // documento en el camino de `pnpm reindex`.
    const arbol = await this.categoryTree.getFreshSnapshot();
    const docs = listings
      .filter((l) => l.status === 'ACTIVE')
      .map((l) => this.toDocument(l, arbol));
    if (docs.length === 0) return;
    await this.index.addDocuments(docs);
  }

  /**
   * PROFUNDIDAD N — RÁFAGA 2. Reindexa los anuncios de una categoría y de TODOS
   * sus descendientes.
   *
   * POR QUÉ EXISTE Y CUÁNDO SE USA. `categoryPath` es la cadena de ancestros del
   * anuncio, así que cambia cuando cambia la jerarquía por encima de él. Para el
   * árbol que ya existe (1-2 niveles) el path calculado con la cadena es
   * BYTE-IDÉNTICO al que se venía escribiendo, así que desplegar esta ráfaga no
   * obliga a reindexar nada. Lo que sí lo obliga es crear una categoría a
   * profundidad ≥3: a partir de ahí hay documentos cuyo path tiene más de dos
   * elementos.
   *
   * ACOTADO A LA SUBCADENA, no global: reindexar el catálogo entero por crear
   * una subcategoría sería desproporcionado, y los anuncios de otras ramas no
   * han cambiado de path.
   *
   * Devuelve cuántos documentos se han reescrito (0 = no había nada que tocar).
   */
  async reindexCategorySubtree(categoryIds: string[], listings: ListingWithRelations[]): Promise<number> {
    if (categoryIds.length === 0 || listings.length === 0) return 0;
    const arbol = await this.categoryTree.getFreshSnapshot();
    const docs = listings
      .filter((l) => l.status === 'ACTIVE')
      .map((l) => this.toDocument(l, arbol));
    if (docs.length === 0) return 0;
    // waitForTask por el mismo motivo que en indexListing: sin él, quien
    // dispara el reindexado no sabe cuándo los documentos son consultables.
    const task = await this.index.addDocuments(docs);
    await this.meili.client.waitForTask(task.taskUid);
    return docs.length;
  }

  // --------------------------------------------------------------------------
  // Search
  // --------------------------------------------------------------------------

  /**
   * Full-text search with filters, facets, geo, and sorting.
   * Returns the raw Meilisearch response; the controller maps it to the API contract.
   */
  async search(params: SearchParams) {
    const filters: string[] = [];

    if (params.categorySlug) filters.push(`categoryPath = "${this.escape(params.categorySlug)}"`);
    if (params.type) filters.push(`type = "${this.escape(params.type)}"`);
    if (params.condition) filters.push(`condition = "${this.escape(params.condition)}"`);
    if (params.priceType) filters.push(`priceType = "${this.escape(params.priceType)}"`);
    if (params.priceUnit) filters.push(`priceUnit = "${this.escape(params.priceUnit)}"`);
    if (params.province) filters.push(`province = "${this.escape(params.province)}"`);
    if (params.city) filters.push(`city = "${this.escape(params.city)}"`);
    if (params.minPrice != null) filters.push(`price >= ${params.minPrice}`);
    if (params.maxPrice != null) filters.push(`price <= ${params.maxPrice}`);
    if (params.listingId) filters.push(`id = "${this.escape(params.listingId)}"`);
    if (params.onlyBoosted) filters.push('boostScore = 1');
    // V-4 — sólo si se pide. Un `false` no emite `hasVideo = false`: eso sería un filtro
    // distinto («solo SIN vídeo») que nadie ha pedido y que acotaría una búsqueda que el
    // usuario cree completa.
    if (params.onlyWithVideo) filters.push('hasVideo = true');

    for (const [key, value] of Object.entries(params.attributes ?? {})) {
      filters.push(
        typeof value === 'string'
          ? `${key} = "${this.escape(value)}"`
          : `${key} = ${value}`,
      );
    }

    // A4 — RANGOS sobre atributos numéricos (km, m², año). Aditivo: la igualdad de
    // arriba sigue exactamente igual, y un atributo puede recibir las dos cosas.
    // Los dos extremos se emiten como cláusulas separadas, que Meilisearch combina
    // con AND igual que el resto de `filters` — un rango cerrado es simplemente las
    // dos a la vez.
    //
    // `Number.isFinite` aunque el parser ya haya validado: esto se interpola CRUDO en
    // la expresión de filtro (un número no se puede citar como una cadena), así que la
    // comprobación se repite aquí en vez de confiar en que el único llamador de hoy
    // siga siendo el único mañana.
    for (const [key, range] of Object.entries(params.attributeRanges ?? {})) {
      if (range.min != null && Number.isFinite(range.min)) filters.push(`${key} >= ${range.min}`);
      if (range.max != null && Number.isFinite(range.max)) filters.push(`${key} <= ${range.max}`);
    }

    // B3 — ETIQUETAS. Una cláusula POR TAG, no una sola con OR: cada elemento de
    // `filters` se combina con AND, así que `?tags=diesel,garantia` exige que el
    // anuncio tenga LAS DOS. Acumular etiquetas ACOTA, igual que acumular filtros de
    // atributo — es lo que espera quien va marcando chips en el panel.
    //
    // `tags` es un array en el documento, y en Meilisearch `tags = "x"` sobre un array
    // significa "contiene x". De ahí que la igualdad baste y no haga falta sintaxis
    // especial.
    for (const tag of params.tags ?? []) {
      filters.push(`tags = "${this.escape(tag)}"`);
    }

    if (params.geo) {
      filters.push(
        `_geoRadius(${params.geo.lat}, ${params.geo.lng}, ${params.geo.radiusMeters})`,
      );
    }

    const sort: string[] = [];
    if (params.geo && !params.sort) {
      // Default: order by proximity when a geo point is given and no explicit sort.
      sort.push(`_geoPoint(${params.geo.lat}, ${params.geo.lng}):asc`);
    } else if (params.sort) {
      sort.push(params.sort);
    }

    // Meilisearch rejects a facet request for any attribute not currently in
    // filterableAttributes — intersect defensively (a name can arrive here from a
    // resolver map computed a moment before a hot-refresh landed) instead of
    // assuming the two always agree. `onlyBoosted` (the featured-block query) never
    // surfaces facets to the frontend, so skip requesting attribute facets for it —
    // free cost reduction now that the list can be as large as every filterable
    // attribute in scope, not just the small curated native set.
    const nativeFacets = NATIVE_FACET_ATTRIBUTES.filter((f) => this.filterableAttributeNames.has(f));
    const attributeFacets = params.onlyBoosted
      ? []
      : (params.attributeFacetNames ?? []).filter((f) => this.filterableAttributeNames.has(f));
    const facets = [...nativeFacets, ...attributeFacets];

    return this.index.search(params.q ?? '', {
      filter: filters.length ? filters : undefined,
      sort: sort.length ? sort : undefined,
      facets,
      page: params.page ?? 1,
      hitsPerPage: params.hitsPerPage ?? 24,
    });
  }

  // --------------------------------------------------------------------------
  // Mapping
  // --------------------------------------------------------------------------

  /** Escapes backslashes and double-quotes in Meilisearch filter string values. */
  private escape(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /**
   * `arbol` es la foto de la jerarquía desde la que se construye `categoryPath`.
   * Se pasa como parámetro en vez de pedirla aquí para que un lote (reindexAll,
   * reindexCategorySubtree) la resuelva UNA vez y no una por documento.
   */
  private toDocument(
    listing: ListingWithRelations,
    arbol: ReadonlyMap<string, CategoryNode>,
  ): ListingDocument {
    const attributes = (listing.attributes as Record<string, unknown>) ?? {};
    const thumbnail = listing.images.find((img) => img.order === 0) ?? listing.images[0];

    // Variable attributes are spread FIRST so that no category attribute can
    // overwrite the core fields below (guards against seeds that reuse reserved
    // names such as "type", which conflicts with the listing-level ListingType).
    return {
      ...attributes,
      id: listing.id,
      title: listing.title,
      description: listing.description,
      price: Number(listing.price),
      currency: listing.currency,
      priceType: listing.priceType,
      priceUnit: listing.priceUnit,
      type: listing.type,
      condition: listing.condition,
      categoryId: listing.category.id,
      categorySlug: listing.category.slug,
      categoryName: listing.category.name,
      // PROFUNDIDAD N — RÁFAGA 2. La cadena COMPLETA de ancestros, de la hoja
      // hacia la raíz. Antes era un literal de 1-2 elementos construido desde el
      // `parent` del include, que sólo llegaba un nivel.
      //
      // BYTE-IDÉNTICO PARA LO QUE YA EXISTE: para una hoja de nivel 2 la cadena
      // es [raíz, hoja] y esto produce [hoja, raíz] — exactamente lo de antes;
      // para una raíz, [raíz]. Por eso desplegar esto no obliga a reindexar.
      //
      // Se invierte AQUÍ, de forma visible, porque `getAncestorChain` sirve
      // siempre raíz→hoja (el orden en el que se pliega la herencia) y este
      // campo se ha leído siempre en el orden contrario.
      //
      // El FILTRO no cambia: `categoryPath = "slug"` es contención en array en
      // Meilisearch, así que filtrar por un ancestro sigue trayendo toda su
      // descendencia sea cual sea la profundidad.
      categoryPath: ancestorChainIn(arbol, listing.category.id)
        .map((n) => n.slug)
        .reverse(),
      province: listing.province,
      city: listing.city,
      ...(listing.latitude != null && listing.longitude != null
        ? { _geo: { lat: listing.latitude, lng: listing.longitude } }
        : {}),
      slug: listing.slug,
      thumbnailUrl: thumbnail?.url ?? null,
      // Already ordered by `order asc` via INDEX_INCLUDE.images.orderBy.
      images: listing.images.map((img) => img.url),
      hasVideo: listing.videoUrl != null,
      sellerId: listing.sellerId,
      sellerName: listing.seller.name,
      sellerSlug: listing.seller.slug,
      sellerAvatarUrl: listing.seller.avatarUrl,
      publishedAt: listing.publishedAt
        ? Math.floor(listing.publishedAt.getTime() / 1000)
        : 0,
      // max(publishedAt, bumpedAt) in ms — bump resurfaces the listing; renew does not
      // (renew preserves publishedAt and never sets bumpedAt).
      sortDate: Math.max(
        listing.publishedAt?.getTime() ?? 0,
        listing.bumpedAt?.getTime() ?? 0,
      ),
      // 1 if a non-revoked, non-expired FEATURED_LISTING entitlement exists; 0 otherwise.
      // expiresAt=null means the entitlement never expires (permanent featured).
      // Evaluated at index time; decays to 0 when the B.1 expiration cron re-indexes (~daily).
      boostScore: listing.entitlements.some(
        (e) => e.expiresAt == null || e.expiresAt > new Date(),
      )
        ? 1
        : 0,
      // B2 — DESPUÉS del `...attributes`, como todo campo core: un atributo de
      // categoría que se llamara `tags` no puede pisarlos. Que además no PUEDA
      // llamarse así lo garantiza RESERVED_ATTRIBUTE_NAMES; esto es la segunda
      // barrera, la estructural, para los datos que ya estuvieran sucios.
      tags: listing.tags.map((t) => t.tag.slug),
      tagNames: listing.tags.map((t) => t.tag.name),
    };
  }
}
