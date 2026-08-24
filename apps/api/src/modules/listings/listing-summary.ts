import type { ListingStatus, ListingType, PriceType, PriceUnit, Prisma } from '@prisma/client';

/**
 * LO QUE UNA TARJETA PUEDE VER. Un solo lector, y por eso vive fuera del servicio.
 *
 * POR QUÉ SE EXTRAJO (fuga de favoritos). `SELECT_SUMMARY` y `toSummary` eran privados de
 * `ListingsService`, así que la única lista que NO pasaba por él —`GET /favorites`, que tenía
 * su propio `include` crudo— devolvía la FILA ENTERA del anuncio: `phone`, `phoneNormalized`,
 * `lastOwnerIp`, `triage`, `watched` y las URLs del vídeo. Diez listas con una forma segura y
 * una undécima con la cruda: el defecto no era que a alguien se le olvidara filtrar, es que
 * **no había nada que reutilizar**.
 *
 * Ahora sí lo hay, y la garantía deja de depender de la disciplina: quien quiera servir
 * tarjetas pide este `select` y pasa las filas por `toSummary`. Los campos sensibles no se
 * descartan uno a uno en cada sitio — es que **no se seleccionan**.
 *
 * ES UN FICHERO SIN MÓDULO, a propósito: son una constante y dos funciones puras. Que
 * `FavoritesService` lo importe NO crea una dependencia de Nest entre los dos módulos (mismo
 * movimiento que `infra/redis/cache-keys.ts`, que comparte el FORMATO de la clave sin
 * compartir la caché).
 *
 * Ver docs/auditoria-pro-video.md, «Hallazgo colateral».
 */

/**
 * El `select` de una tarjeta. **Lista blanca**: lo que no está aquí no sale, hoy ni cuando
 * `Listing` gane una columna nueva.
 */
export const SELECT_SUMMARY = {
  id: true,
  title: true,
  slug: true,
  price: true,
  currency: true,
  priceType: true,
  // RP.4b — el sufijo del precio ("/mes", "/hora"). Los hits de Meilisearch ya lo traían y
  // este select no, así que las listas servidas desde Postgres pintaban "200 €" donde la
  // búsqueda pintaba "200 €/mes". Se añade al extraer el select porque, sin él, favoritos
  // —que hasta ahora traía la fila entera y por tanto SÍ lo tenía— habría perdido el sufijo
  // al pasar por aquí: cerrar una fuga no puede costar una regresión visible.
  priceUnit: true,
  // ATRIBUTOS EN CARD — respetar producto/servicio: sin `type` aquí, el fallback a
  // Postgres (findByCategory y demás usos de SELECT_SUMMARY) no podía filtrar los
  // atributos de card por tipo de anuncio — a diferencia del documento de Meilisearch,
  // que ya indexaba `type` desde antes (ver toDocument() en search.service.ts).
  type: true,
  city: true,
  province: true,
  status: true,
  publishedAt: true,
  expiresAt: true,
  bumpedAt: true,
  attributes: true,
  viewCount: true,
  category: { select: { slug: true } },
  images: { orderBy: { order: 'asc' as const }, take: 1, select: { url: true } },
  // Vídeo Pro — se selecciona la URL SOLO para derivar `hasVideo`; la URL en sí NUNCA
  // sale en el resumen de tarjeta. Es lo que garantiza el cero-bytes-de-vídeo en listas por
  // construcción y no por disciplina: sin dirección, no hay nada que descargar.
  videoUrl: true,
  // Escaparate RÁFAGA 4 — necesario para enriquecer la card con la media
  // verificada del vendedor en lote (ver attachSellerRatings), no para
  // mostrarlo tal cual.
  sellerId: true,
} as const;

export type SummaryDbRow = {
  id: string;
  title: string;
  slug: string;
  price: Prisma.Decimal;
  currency: string;
  priceType: PriceType;
  priceUnit: PriceUnit;
  type: ListingType;
  city: string | null;
  province: string | null;
  status: ListingStatus;
  publishedAt: Date | null;
  expiresAt: Date | null;
  bumpedAt: Date | null;
  attributes: Prisma.JsonValue;
  viewCount: number;
  category: { slug: string };
  images: { url: string }[];
  videoUrl: string | null;
  sellerId: string;
};

/** La fila de `SELECT_SUMMARY` convertida en lo que la tarjeta consume. */
export function toSummary({
  images,
  bumpedAt,
  attributes,
  category,
  videoUrl,
  ...rest
}: SummaryDbRow) {
  return {
    ...rest,
    // SOLO EL BOOLEANO. `videoUrl` se desestructura fuera a propósito, para que no pueda
    // colarse en `...rest`: una tarjeta que recibiera la dirección podría descargar el
    // vídeo, y el cero-bytes-en-listas dejaría de ser una garantía estructural.
    hasVideo: videoUrl != null,
    thumbnailUrl: images[0]?.url ?? undefined,
    bumpedAt: bumpedAt?.toISOString() ?? undefined,
    categorySlug: category.slug,
    attributes: (attributes as Record<string, unknown>) ?? {},
  };
}

/**
 * Lo único que `attachSellerRatings` necesita de `ReviewsService`. Un parámetro y no una
 * dependencia inyectada: esto es una función pura sobre un lector, no un servicio.
 */
export interface SellerRatingReader {
  getRatingSummaries(
    userIds: string[],
  ): Promise<Map<string, { average: number | null; count: number }>>;
}

/**
 * Escaparate RÁFAGA 4 — la reputación del vendedor, en LOTE (una consulta por página, no una
 * por tarjeta). Se aplica después de `toSummary` porque no sale del anuncio sino del vendedor.
 */
export async function attachSellerRatings<T extends { sellerId: string }>(
  reviews: SellerRatingReader,
  items: T[],
): Promise<(T & { sellerRatingAverage: number | null; sellerRatingCount: number })[]> {
  const sellerIds = [...new Set(items.map((i) => i.sellerId))];
  const ratings = await reviews.getRatingSummaries(sellerIds);
  return items.map((item) => {
    const rating = ratings.get(item.sellerId);
    return {
      ...item,
      sellerRatingAverage: rating?.average ?? null,
      sellerRatingCount: rating?.count ?? 0,
    };
  });
}
