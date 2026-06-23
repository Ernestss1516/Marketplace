// ============================================================================
//  modules/search/search.service.ts
//  Integración con Meilisearch derivada del schema.prisma.
//
//  Responsabilidades:
//   1. Configurar el índice (atributos buscables, filtrables, ordenables).
//   2. Mapear un Listing de Prisma al documento que se indexa (aplanando el jsonb).
//   3. Indexar / actualizar / borrar anuncios y resolver consultas.
//
//  Recuerda el flujo: Meilisearch devuelve resultados de búsqueda; PostgreSQL
//  sigue siendo la fuente de verdad. Aquí indexamos lo justo para buscar, filtrar
//  y pintar la tarjeta de resultado sin volver a la base de datos en cada listado.
//
//  Requiere:  npm i meilisearch
// ============================================================================

import { Injectable, OnModuleInit } from '@nestjs/common';
import { MeiliSearch, Index } from 'meilisearch';
import type { Listing, ListingImage } from '@prisma/client';

const INDEX_NAME = 'listings';

// ----------------------------------------------------------------------------
//  Forma del documento indexado.
//  Los campos de Listing.attributes (jsonb) se aplanan al nivel superior porque
//  Meilisearch necesita campos de primer nivel para filtrar y ordenar.
//  Meilisearch es schema-less: documentos de categorías distintas pueden tener
//  campos distintos (un coche trae `km`, un piso trae `surface`) sin problema.
// ----------------------------------------------------------------------------
export interface ListingDocument {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  type: string;            // PRODUCT | SERVICE
  condition: string | null;

  // Datos de categoría (desnormalizados para filtrar y mostrar)
  categoryId: string;
  categorySlug: string;
  categoryName: string;

  // Ubicación
  province: string | null;
  city: string | null;
  _geo?: { lat: number; lng: number }; // formato que Meilisearch usa para geo-search

  // Datos para pintar la tarjeta de resultado sin tocar Postgres
  slug: string;
  thumbnailUrl: string | null;
  sellerId: string;

  // Orden / relevancia
  publishedAt: number;     // timestamp UNIX (Meilisearch ordena mejor con números)

  // Atributos variables aplanados (year, km, fuel, surface, rooms, …)
  [attribute: string]: unknown;
}

// ----------------------------------------------------------------------------
//  Configuración del índice.
// ----------------------------------------------------------------------------
const SEARCHABLE_ATTRIBUTES = [
  // El orden importa: define la prioridad de relevancia del texto.
  'title',
  'brand',
  'model',
  'categoryName',
  'description',
];

const FILTERABLE_ATTRIBUTES = [
  // Campos propios del anuncio
  'categoryId',
  'categorySlug',
  'type',
  'condition',
  'price',
  'province',
  'city',
  '_geo',
  // Unión de atributos filtrables de todas las categorías (del attributeSchema).
  // Un documento que no tenga el campo simplemente no se ve afectado por su filtro.
  'brand',
  'model',
  'year',
  'km',
  'fuel',
  'transmission',
  'doors',
  'cc',
  'surface',
  'rooms',
  'bathrooms',
  'floor',
  'elevator',
  'furnished',
  'storage',
];

const SORTABLE_ATTRIBUTES = ['price', 'publishedAt', '_geo'];

const RANKING_RULES = [
  // Reglas por defecto de Meilisearch…
  'words',
  'typo',
  'proximity',
  'attribute',
  'sort',
  'exactness',
  // …más un desempate propio: a igualdad de relevancia, lo más reciente primero.
  'publishedAt:desc',
];

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly client: MeiliSearch;
  private readonly index: Index<ListingDocument>;

  constructor() {
    this.client = new MeiliSearch({
      host: process.env.MEILI_HOST ?? 'http://localhost:7700',
      apiKey: process.env.MEILI_MASTER_KEY,
    });
    this.index = this.client.index<ListingDocument>(INDEX_NAME);
  }

  /** Al arrancar el módulo, asegura que el índice existe y aplica los settings. */
  async onModuleInit(): Promise<void> {
    await this.client.createIndex(INDEX_NAME, { primaryKey: 'id' }).catch(() => undefined);
    await this.index.updateSettings({
      searchableAttributes: SEARCHABLE_ATTRIBUTES,
      filterableAttributes: FILTERABLE_ATTRIBUTES,
      sortableAttributes: SORTABLE_ATTRIBUTES,
      rankingRules: RANKING_RULES,
      // Tolerancia a erratas: a partir de 4 caracteres admite 1 typo, de 8 admite 2.
      typoTolerance: {
        enabled: true,
        minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
      },
    });
  }

  // --------------------------------------------------------------------------
  //  Mapeo Prisma -> documento Meilisearch.
  //  `listing` debe venir con su categoría e imágenes incluidas desde Prisma.
  // --------------------------------------------------------------------------
  private toDocument(
    listing: Listing & {
      category: { id: string; slug: string; name: string };
      images: ListingImage[];
    },
  ): ListingDocument {
    const attributes = (listing.attributes as Record<string, unknown>) ?? {};
    const thumbnail = listing.images.find((img) => img.order === 0) ?? listing.images[0];

    return {
      id: listing.id,
      title: listing.title,
      description: listing.description,
      price: Number(listing.price), // Decimal -> number para que Meili pueda ordenar/filtrar
      currency: listing.currency,
      type: listing.type,
      condition: listing.condition,
      categoryId: listing.category.id,
      categorySlug: listing.category.slug,
      categoryName: listing.category.name,
      province: listing.province,
      city: listing.city,
      _geo:
        listing.latitude != null && listing.longitude != null
          ? { lat: listing.latitude, lng: listing.longitude }
          : undefined,
      slug: listing.slug,
      thumbnailUrl: thumbnail?.url ?? null,
      sellerId: listing.sellerId,
      publishedAt: listing.publishedAt ? Math.floor(listing.publishedAt.getTime() / 1000) : 0,
      // Aplana los atributos variables al nivel superior del documento.
      ...attributes,
    };
  }

  // --------------------------------------------------------------------------
  //  Indexado de un anuncio. Solo se indexan los ACTIVE; si pasa a otro estado
  //  (vendido, caducado, rechazado…) se retira del índice.
  // --------------------------------------------------------------------------
  async indexListing(
    listing: Listing & {
      category: { id: string; slug: string; name: string };
      images: ListingImage[];
    },
  ): Promise<void> {
    if (listing.status !== 'ACTIVE') {
      await this.removeListing(listing.id);
      return;
    }
    await this.index.addDocuments([this.toDocument(listing)]);
  }

  /** Retira un anuncio del índice. */
  async removeListing(id: string): Promise<void> {
    await this.index.deleteDocument(id);
  }

  /** Reindexado masivo (p. ej. desde un worker de BullMQ). */
  async reindexAll(
    listings: (Listing & {
      category: { id: string; slug: string; name: string };
      images: ListingImage[];
    })[],
  ): Promise<void> {
    const docs = listings
      .filter((l) => l.status === 'ACTIVE')
      .map((l) => this.toDocument(l));
    await this.index.addDocuments(docs);
  }

  // --------------------------------------------------------------------------
  //  Búsqueda. Devuelve IDs y datos de tarjeta; el controlador decide si hidrata
  //  más detalle desde Postgres.
  // --------------------------------------------------------------------------
  async search(params: {
    q?: string;
    categorySlug?: string;
    type?: string;
    minPrice?: number;
    maxPrice?: number;
    province?: string;
    // Filtros sobre atributos variables: { fuel: 'Diésel', year: 2018 }
    attributes?: Record<string, string | number | boolean>;
    // Geo: buscar dentro de un radio y ordenar por cercanía
    geo?: { lat: number; lng: number; radiusMeters: number };
    sort?: 'price:asc' | 'price:desc' | 'publishedAt:desc';
    page?: number;
    hitsPerPage?: number;
  }) {
    const filters: string[] = [];

    if (params.categorySlug) filters.push(`categorySlug = "${params.categorySlug}"`);
    if (params.type) filters.push(`type = "${params.type}"`);
    if (params.province) filters.push(`province = "${params.province}"`);
    if (params.minPrice != null) filters.push(`price >= ${params.minPrice}`);
    if (params.maxPrice != null) filters.push(`price <= ${params.maxPrice}`);

    for (const [key, value] of Object.entries(params.attributes ?? {})) {
      filters.push(typeof value === 'string' ? `${key} = "${value}"` : `${key} = ${value}`);
    }

    if (params.geo) {
      filters.push(`_geoRadius(${params.geo.lat}, ${params.geo.lng}, ${params.geo.radiusMeters})`);
    }

    // Orden: por distancia si hay geo y no se pidió otro orden; si no, el solicitado.
    const sort: string[] = [];
    if (params.geo && !params.sort) {
      sort.push(`_geoPoint(${params.geo.lat}, ${params.geo.lng}):asc`);
    } else if (params.sort) {
      sort.push(params.sort);
    }

    return this.index.search(params.q ?? '', {
      filter: filters.length ? filters : undefined,
      sort: sort.length ? sort : undefined,
      page: params.page ?? 1,
      hitsPerPage: params.hitsPerPage ?? 24,
    });
  }
}
