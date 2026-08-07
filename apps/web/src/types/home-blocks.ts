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

export interface HomeGridCell {
  media?: HomeGridMedia;
  title: string;
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

/**
 * Tipos registrados. Los que faltan entran con su DTO, su renderizador y su
 * editor en la misma ráfaga cada uno (docs/diseno-portada.md §8):
 *   RP.1  cta, search
 *   RP.4  grid, steps          ← registrados
 *   RP.5  listings, categoryCarousel
 *   RP.6  searchTable
 *
 * Al añadir un tipo aquí, los `switch` exhaustivos de `HomeBlockRenderer` (RP.2)
 * y `HomeBlockEditorRow` (RP.3) dejan de compilar hasta que tiene renderizador Y
 * editor. El compilador ES la garantía de que nada nazca a medias.
 */
export type HomeBlock = HomeCtaBlock | HomeSearchBlock | HomeGridBlock | HomeStepsBlock;

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
