// Motor de bloques de PORTADA — unión discriminada por `type`, espejo de los
// DTOs de apps/api/src/modules/homepage/dto/blocks/*.dto.ts. El orden es la
// posición en el array `HomepageConfig.blocks`: no hay campo `order` por bloque
// (no son filas separadas, viven todas en un único Json de una fila).
//
// FICHERO PROPIO, NO `types/blocks.ts` (docs/diseno-portada.md §2.4): este es un
// motor NUEVO, hermano del del blog pero independiente. La regla de reuso entre
// los dos (§4.0) es que se comparte todo componente cuya firma NO mencione un
// tipo de bloque; nada que lleve un `Block` cruza la frontera. Por eso estos
// tipos no importan nada de `@/types/blocks`.

export interface BaseHomeBlock {
  // Generado en cliente con generateId() (lib/utils.ts) y persistido tal cual —
  // da React keys estables y permite reordenar/editar sin bugs de índice. El
  // backend solo valida que sea un string no vacío, nunca lo genera ni lo
  // reescribe.
  id: string;
}

export type HomeCtaStyle = 'primary' | 'secondary' | 'outline';

/** Botón destacado. Cubre el "Publica gratis" que la home pinta hoy a mano. */
export interface HomeCtaBlock extends BaseHomeBlock {
  type: 'cta';
  label: string;
  href: string;
  style?: HomeCtaStyle;
}

/**
 * Buscador. No guarda datos, guarda la decisión de mostrarlo y sus adornos: el
 * árbol de categorías lo carga el Server Component de la página y se lo pasa a
 * `SearchBar` por props, como ya hace hoy.
 */
export interface HomeSearchBlock extends BaseHomeBlock {
  type: 'search';
  eyebrow?: string;
  showPopularCategories?: boolean;
  popularCount?: number;
}

/**
 * ALLOWLIST CERRADA de iconos. Espejo de HOME_ICON_NAMES del backend
 * (modules/homepage/dto/blocks/home-icons.ts): los dos ficheros crecen a la vez.
 *
 * Cerrada y no un nombre libre de lucide porque resolver el icono en runtime
 * rompería el tree-shaking y arrastraría la librería entera al bundle de la ruta
 * más visitada del sitio (docs/diseno-portada.md §4.3). El mapa
 * nombre→componente vive en components/home/home-icons.tsx.
 */
export const HOME_ICON_NAMES = [
  'shield-check',
  'message-circle',
  'star',
  'sparkles',
  'search',
  'upload',
  'heart',
  'tag',
  'truck',
  'wallet',
  'users',
  'thumbs-up',
] as const;

export type HomeIconName = (typeof HOME_ICON_NAMES)[number];

/**
 * Media de una celda de rejilla: unión discriminada por `kind`.
 * `image` obliga a `alt` (accesibilidad y SEO); `icon` a un nombre de la lista.
 */
export type HomeGridMedia =
  | { kind: 'image'; url: string; alt: string }
  | { kind: 'icon'; name: HomeIconName };

/** Columnas admitidas: las cinco que el renderizador tiene como clases estáticas. */
export const GRID_COLUMNS = [1, 2, 3, 4, 6] as const;
export type GridColumns = (typeof GRID_COLUMNS)[number];

/**
 * Una tarjeta de la rejilla. Desde el ajuste 6, lo único obligatorio es el `media`.
 *
 * OJO AL LEER DATOS YA GUARDADOS: el tipo describe lo que el backend **acepta ahora**, no lo
 * que pueda haber en la fila. `media` fue opcional hasta el ajuste 6 y el editor ofrecía
 * crear tarjetas sin él, así que una portada antigua puede traer celdas que violan este tipo.
 * Por eso el renderizador y el editor lo tratan como si pudiera faltar: endurecer el esquema
 * no reescribe lo guardado.
 */
export interface HomeGridCell {
  media: HomeGridMedia;
  /** Opcional desde el ajuste 6: una tarjeta puede ser sólo una imagen. */
  title?: string;
  description?: string;
  /** Sin href, la celda se pinta como <div>: las señales de confianza no enlazan. */
  href?: string;
}

/** Rejilla de tarjetas. Cubre también las señales de confianza (icono + texto). */
export interface HomeGridBlock extends BaseHomeBlock {
  type: 'grid';
  title?: string;
  columns: GridColumns;
  items: HomeGridCell[];
}

export interface HomeStepItem {
  title: string;
  description: string;
}

/**
 * Una columna de pasos con su audiencia. Es la desviación respecto al `steps`
 * del blog, que es una secuencia única: la portada tiene dos públicos a la vez.
 */
export interface HomeStepsColumn {
  audienceTitle: string;
  icon?: HomeIconName;
  steps: HomeStepItem[];
  cta?: { label: string; href: string };
}

export interface HomeStepsBlock extends BaseHomeBlock {
  type: 'steps';
  title?: string;
  columns: HomeStepsColumn[];
}

export const LISTINGS_LIMITS = [4, 6, 8, 12] as const;
export type ListingsLimit = (typeof LISTINGS_LIMITS)[number];
export type ListingsSort = 'recent' | 'featured';

/**
 * Bloque DINÁMICO: no guarda contenido, guarda una consulta que se resuelve
 * contra `search()` antes del render.
 *
 * `categorySlug` es OPCIONAL, y esa es la diferencia de fondo con el bloque
 * homónimo del blog: ausente = los recientes de TODO el sitio, que es lo que la
 * portada hacía escrito a mano (docs/diseno-portada.md §4.6).
 */
export interface HomeListingsBlock extends BaseHomeBlock {
  type: 'listings';
  title?: string;
  categorySlug?: string;
  limit: ListingsLimit;
  sort?: ListingsSort;
  showAllLink?: boolean;
}

export interface HomeCategoryCarouselItem {
  categorySlug: string;
  /** Imagen PROPIA del bloque (upload), nunca `Category.iconUrl`. */
  imageUrl: string;
  alt: string;
  /** Texto visible; ausente = el nombre de la categoría. */
  label?: string;
}

export interface HomeCategoryCarouselBlock extends BaseHomeBlock {
  type: 'categoryCarousel';
  title?: string;
  items: HomeCategoryCarouselItem[];
}

export const SEARCH_TABLE_COLUMNS = [2, 3, 4] as const;
export type SearchTableColumns = (typeof SEARCH_TABLE_COLUMNS)[number];

export interface SearchTableCombo {
  categorySlug: string;
  province: string;
}

/**
 * Las tres clases de pestaña de la tabla de búsquedas. El admin elige cuáles y
 * en qué orden; el contenido de TODAS las activas viaja en el HTML.
 */
export type SearchTableTab =
  | { kind: 'locations'; label: string }
  | { kind: 'categories'; label: string; includeChildren?: boolean }
  | { kind: 'combos'; label: string; items: SearchTableCombo[] };

export interface HomeSearchTableBlock extends BaseHomeBlock {
  type: 'searchTable';
  title?: string;
  tabs: SearchTableTab[];
  columns?: SearchTableColumns;
}

/**
 * LOS 7 TIPOS DEL MOTOR, todos registrados. Cada uno entró con su DTO, su
 * renderizador y su editor en la misma ráfaga (docs/diseno-portada.md §8):
 *   RP.1  cta, search
 *   RP.4  grid, steps
 *   RP.5  listings, categoryCarousel
 *   RP.6  searchTable
 *   V2    videoUpload                 ← el último (docs/diseno-video-bloque.md)
 *
 * La garantía sigue viva para cualquier tipo futuro: al añadirlo aquí, los
 * `switch` exhaustivos de `HomeBlockRenderer` y `HomeBlockEditorRow`, el
 * `Record` de `HOME_BLOCK_TYPE_META` y los dos `switch` de `homeBlockDefaults`
 * dejan de compilar hasta que tenga renderizador Y editor. Se ha visto disparar
 * en RP.4, RP.5 y RP.6, y siempre en los mismos cinco sitios.
 */
/**
 * VÍDEO SUBIDO en la portada. Mismos campos y mismas reglas que el `VideoUploadBlock` del
 * blog, tipo propio — la frontera entre los dos motores no se cruza con un tipo de bloque
 * (ver la cabecera de este fichero). Lo que sí se comparte es lo que no menciona ningún
 * bloque: `VideoPlayer` al pintarlo y el control de subida al editarlo.
 *
 * `url` es la URL COMPLETA, nunca la clave, y el editor guarda aquí la TEMPORAL: el backend
 * la promociona a definitiva al guardar la portada.
 */
export interface HomeVideoUploadBlock extends BaseHomeBlock {
  type: 'videoUpload';
  url: string;
  poster?: string;
  caption?: string;
}

export type HomeBlock =
  | HomeCtaBlock
  | HomeSearchBlock
  | HomeGridBlock
  | HomeStepsBlock
  | HomeListingsBlock
  | HomeCategoryCarouselBlock
  | HomeSearchTableBlock
  | HomeVideoUploadBlock;

/**
 * Configuración completa de la portada, tal como la sirve `GET /homepage`.
 *
 * El HERO son campos propios, FUERA del array: es la única pieza cuyo
 * comportamiento depende de su posición, y sacarlo del array es lo que permite
 * que ningún bloque conozca su índice (docs/diseno-portada.md §2.3).
 */
export interface HomepageConfig {
  /** Parte fija del <h1>. Nunca vacía: la portada siempre tiene un <h1> real. */
  heroStaticTitle: string;
  /** Opciones que rotan tras la parte fija. [] = título estático, sin animación. */
  heroRotatingOptions: string[];
  /** Milisegundos que cada opción permanece visible. */
  heroRotationMs: number;
  heroSubtitle: string | null;
  blocks: HomeBlock[];
}
