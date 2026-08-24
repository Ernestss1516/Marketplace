import { Prisma } from '@prisma/client';
import type { ListingStatus, ListingType, PriceType, PriceUnit } from '@prisma/client';

/**
 * LAS TRES FORMAS EN QUE UN ANUNCIO SALE DE LA API, y las tres son LISTAS BLANCAS.
 *
 *   · `SELECT_SUMMARY` + `toSummary`            — la TARJETA (las once listas).
 *   · `LISTING_PUBLIC_SELECT` + `toPublicListing` — la FICHA PÚBLICA (`GET /listings/:slug`).
 *   · `LISTING_OWNER_SELECT` + `toOwnerListing`   — el anuncio para SU DUEÑO (editor y
 *     acciones del ciclo de vida).
 *
 * POR QUÉ LAS TRES VIVEN JUNTAS. Son la misma pregunta hecha tres veces —«¿qué puede ver
 * QUIÉN de un anuncio?»— y tenerlas en un fichero es lo que permite compararlas de un
 * vistazo. Repartidas por los servicios fue exactamente como se abrieron las dos fugas que
 * este fichero cierra.
 *
 * LA REGLA, la misma para las tres: **lo que no se enumera, no se selecciona, y lo que no
 * se selecciona no puede salir** — hoy ni cuando `Listing` gane una columna nueva. No hay
 * ninguna forma que se construya quitando campos a una fila cruda: eso es lo que fallaba.
 *
 * LOS CAMPOS QUE NINGUNA DE LAS TRES SIRVE:
 *   · `phoneNormalized` — el teléfono publicado, sin prefijo ni separadores. Es el MISMO
 *     número que `phone`, y filtrar uno dejando pasar el otro no protege nada.
 *   · `lastOwnerIp`, `lastOwnerInteractionAt` — rastro forense del vendedor. El backoffice
 *     los trata como dato de staff que ni siquiera se sirve en su propia lista.
 *   · `triage`, `watched` — etiquetas INTERNAS de moderación. No las ve el público, y
 *     tampoco el dueño del anuncio: son notas del equipo sobre él.
 *
 * `phone` es el único campo sensible que alguna de las tres selecciona, y por un motivo
 * concreto en cada caso: la ficha pública lo pide SÓLO para derivar `hasPhone` y lo tira
 * (igual que `videoUrl` → `hasVideo` en la tarjeta), y el dueño sí puede ver el suyo porque
 * el editor lo edita.
 *
 * Ver docs/auditoria-pro-video.md: «Hallazgo colateral» (favoritos) y «Hallazgo NUEVO y MÁS
 * GRAVE» (la ficha pública).
 */

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

// ─────────────────────────────────────────────────────────────────────────────
//  LA FICHA PÚBLICA — `GET /listings/:slug`
// ─────────────────────────────────────────────────────────────────────────────

/** Las relaciones que la ficha pinta, enumeradas campo a campo igual que los escalares. */
const RELACIONES_DE_FICHA = {
  // `uploadedById` y `listingId` NO: son de la fila de la imagen, no de la foto.
  images: {
    orderBy: { order: 'asc' as const },
    select: { id: true, url: true, alt: true, width: true, height: true, order: true },
  },
  // A1 — `parent` para el breadcrumb y la URL canónica.
  category: {
    select: { id: true, slug: true, name: true, parent: { select: { slug: true, name: true } } },
  },
  // `id` lo necesita `findBySlug` para pedir la media del vendedor; `trusted` es la
  // insignia de la ficha (H8 bloque E). Nada más del usuario sale por aquí.
  seller: { select: { id: true, name: true, slug: true, avatarUrl: true, trusted: true } },
  // B2 — ordenados por el `orden` del catálogo, no por el de inserción.
  tags: {
    orderBy: { tag: { orden: 'asc' as const } },
    select: { tag: { select: { id: true, slug: true, name: true } } },
  },
} as const;

/**
 * LO QUE UN VISITANTE ANÓNIMO PUEDE VER. Sustituye al `include: LISTING_INCLUDE` que servía
 * la fila entera y sólo descartaba `phone` y `tags` — una defensa de dos exclusiones sobre
 * un payload de cuarenta campos, en el endpoint MÁS expuesto de la plataforma.
 *
 * `phone` SE SELECCIONA Y NO SE SIRVE, exactamente como `videoUrl` en la tarjeta: hace falta
 * para saber si hay teléfono (`hasPhone`), y `toPublicListing` lo desestructura fuera antes
 * de que nada lo vea. Es el único campo de esta lista que no llega al cliente, y por eso
 * está comentado aquí y comprobado en el barrido e2e.
 */
export const LISTING_PUBLIC_SELECT = {
  id: true,
  title: true,
  slug: true,
  description: true,
  price: true,
  currency: true,
  priceType: true,
  priceUnit: true,
  type: true,
  condition: true,
  status: true,
  attributes: true,
  city: true,
  province: true,
  postalCode: true,
  latitude: true,
  longitude: true,
  publishedAt: true,
  viewCount: true,
  // Del que `findBySlug` deriva `nextBumpAt` fuera del blob cacheado.
  bumpedAt: true,
  // Vídeo Pro — en la FICHA sí viaja la dirección: es donde el vídeo se ve.
  videoUrl: true,
  videoPosterUrl: true,
  // SÓLO para derivar `hasPhone`. Ver el comentario del bloque.
  phone: true,
  ...RELACIONES_DE_FICHA,
} as const;

type PublicRow = Prisma.ListingGetPayload<{ select: typeof LISTING_PUBLIC_SELECT }>;

/**
 * La fila pública convertida en el payload de la ficha: el teléfono se cambia por el
 * booleano y los tags se aplanan a `TagRef[]`.
 *
 * ES EL ÚNICO PUNTO donde se decide la forma pública, y por eso también es el punto que se
 * cachea: `findBySlug` guarda en Redis exactamente esto, así que un blob cacheado no puede
 * llevar nada que esta función no emita.
 */
export function toPublicListing({ phone, tags, ...resto }: PublicRow) {
  return {
    ...resto,
    // El número NUNCA viaja aquí. Se sirve sólo por `GET /listings/:id/phone`, que exige
    // sesión, limita por usuario Y por IP, y sólo responde de anuncios ACTIVE.
    hasPhone: Boolean(phone),
    tags: tags.map((t) => t.tag),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  EL ANUNCIO PARA SU DUEÑO — editor y acciones del ciclo de vida
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LO QUE EL DUEÑO PUEDE VER DE SU PROPIO ANUNCIO. Casi todo: es suyo. Las dos diferencias
 * con la ficha pública van en direcciones opuestas y las dos son deliberadas:
 *
 *   · **SÍ** `phone` — el editor lo edita, así que tiene que poder leerlo. `phoneNormalized`
 *     sigue fuera: es una copia derivada que nadie edita ni muestra.
 *   · **NO** `triage` ni `watched` — son notas del EQUIPO sobre este anuncio. Que las viera
 *     su dueño era el agravante del hallazgo: un anuncio denunciado le enseñaba al
 *     denunciado que estaba vigilado.
 *   · **NO** `lastOwnerIp` ni `lastOwnerInteractionAt` — rastro forense, no dato de gestión.
 *
 * `needsRevalidation` SÍ entra, y no es una excepción a lo anterior: es un aviso PARA el
 * dueño («tu anuncio dejó de cumplir la configuración de su categoría»), no una nota sobre
 * él. Es el mismo campo que `findMine` ya sirve en la tarjeta del propietario.
 */
export const LISTING_OWNER_SELECT = {
  ...LISTING_PUBLIC_SELECT,
  // Suyo, y el editor lo edita.
  phone: true,
  expiresAt: true,
  needsRevalidation: true,
  createdAt: true,
  updatedAt: true,
  sellerId: true,
  categoryId: true,
  videoDurationSeconds: true,
  videoUploadedAt: true,
} as const;

type OwnerRow = Prisma.ListingGetPayload<{ select: typeof LISTING_OWNER_SELECT }>;

/** Aplana los tags. El teléfono se queda: es suyo. */
export function toOwnerListing({ tags, ...resto }: OwnerRow) {
  return { ...resto, tags: tags.map((t) => t.tag) };
}

/**
 * LA MISMA LISTA BLANCA, APLICADA A UNA FILA QUE YA SE TIENE.
 *
 * Las acciones del ciclo de vida (publicar, reservar, pausar, archivar, renovar, cerrar y
 * deshacer un trato) devuelven al cliente la fila que acaban de escribir, y esa fila la
 * necesitan COMPLETA para su propia lógica —la puerta de validación, la moderación previa y
 * el reindexado leen campos que el cliente no debe ver—. Estrechar su `select` habría sido
 * arreglar la salida rompiendo el motor.
 *
 * Así que la lista blanca se aplica en la SALIDA: se proyecta la fila sobre las mismas
 * claves de `LISTING_OWNER_SELECT`. La garantía es la misma —una columna nueva de `Listing`
 * no aparece porque nadie la nombra— y el interior de cada operación queda intacto.
 */
/** Todas las columnas de `Listing`, tal y como las declara el esquema. Lo genera Prisma, así
 *  que no puede quedarse desactualizado cuando la tabla gane una columna. */
const COLUMNAS_DE_ANUNCIO: ReadonlySet<string> = new Set(
  Object.keys(Prisma.ListingScalarFieldEnum),
);
const COLUMNAS_PERMITIDAS_AL_DUENO: ReadonlySet<string> = new Set(
  Object.keys(LISTING_OWNER_SELECT),
);

/**
 * LA LISTA BLANCA GOBIERNA LAS COLUMNAS, NO EL OBJETO ENTERO — y la distinción se pagó cara.
 *
 * El primer intento proyectaba la respuesta sobre las claves de `LISTING_OWNER_SELECT` y
 * tiraba todo lo demás. La batería lo cazó: `publish` devuelve el anuncio **más** un aviso
 * (`publishBlocked`, la degradación cuando el correo no está verificado), y la proyección se
 * lo comía — el vendedor habría visto su anuncio quedarse en DRAFT sin que nada le dijera
 * por qué.
 *
 * Así que se filtra lo que hay que filtrar y nada más: de las claves que son COLUMNAS de
 * `Listing` sólo pasan las de la lista blanca; cualquier otra clave —un campo DERIVADO que
 * el servicio ha calculado: `publishBlocked`, `featuredUntil`, `nextBumpAt`— pasa intacta.
 *
 * La garantía se conserva entera, porque lo que se filtra es exactamente lo que puede
 * filtrarse: una columna nueva y sensible en `Listing` **no** sale, porque estará en
 * `COLUMNAS_DE_ANUNCIO` —que Prisma genera— y no en la lista blanca. Lo que ya no se pierde
 * por el camino es lo que nunca estuvo en la base de datos.
 */
function pickOwnerFields(row: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(row)) {
    if (COLUMNAS_DE_ANUNCIO.has(clave) && !COLUMNAS_PERMITIDAS_AL_DUENO.has(clave)) continue;
    salida[clave] = valor;
  }
  return salida;
}

/**
 * La respuesta de una acción del ciclo de vida, saneada.
 *
 * DOS FORMAS, y las dos se cubren aquí porque son las dos que existen: ocho de las nueve
 * acciones devuelven el anuncio a secas y `closeDeal` devuelve `{listing, deal}`. La
 * presencia de la clave `listing` las distingue sin ambigüedad — una fila de `Listing` no
 * tiene un campo que se llame así.
 *
 * El `deal` NO se toca: es del dueño, describe SU trato y no lleva nada del anuncio.
 */
export function toOwnerResponse<T extends object>(resultado: T): Record<string, unknown> {
  const fila = resultado as Record<string, unknown>;
  const anidado = fila.listing;
  if (anidado !== null && typeof anidado === 'object') {
    return { ...fila, listing: pickOwnerFields(anidado as Record<string, unknown>) };
  }
  return pickOwnerFields(fila);
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
