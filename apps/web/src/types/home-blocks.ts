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
 * RP.1 registra dos tipos. Los cinco restantes entran con su DTO, su
 * renderizador y su editor en la misma ráfaga cada uno (docs/diseno-portada.md §8):
 *   RP.4  grid, steps
 *   RP.5  listings, categoryCarousel
 *   RP.6  searchTable
 *
 * Al añadirse aquí, el `switch` exhaustivo de `HomeBlockRenderer` (RP.2) deja
 * de compilar hasta que el tipo tiene su `case` — el compilador ES la garantía
 * de que esquema y renderizador nunca divergen, igual que en el blog.
 */
export type HomeBlock = HomeCtaBlock | HomeSearchBlock;

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
