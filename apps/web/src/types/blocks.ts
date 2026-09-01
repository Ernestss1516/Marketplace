// Sistema de bloques — unión discriminada por `type`, espejo exacto de los 9
// DTOs del backend (apps/api/src/modules/blog/dto/blocks/*.dto.ts). El orden
// es la posición en el array `Post.blocks` — no hay un campo `order` por
// bloque (no son filas separadas, viven todas en un único Json de una fila).

export interface BaseBlock {
  // Generado en cliente con generateId() (lib/utils.ts) y persistido tal
  // cual — da React keys estables y permite reordenar/editar sin bugs de
  // índice (Ráfaga 2, editor). El backend solo valida que sea un string no
  // vacío, nunca lo genera ni lo reescribe.
  id: string;
}

export interface TextBlock extends BaseBlock {
  type: 'text';
  markdown: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqBlock extends BaseBlock {
  type: 'faq';
  title?: string;
  items: FaqItem[];
}

export interface HubLink {
  label: string;
  href: string;
  description?: string;
}

export interface HubBlock extends BaseBlock {
  type: 'hub';
  title?: string;
  links: HubLink[];
}

export type ImagePosition = 'left' | 'center' | 'right' | 'full';

export interface ImageBlock extends BaseBlock {
  type: 'image';
  url: string;
  alt: string;
  caption?: string;
  position?: ImagePosition;
  width?: number;
}

export type CtaStyle = 'primary' | 'secondary' | 'outline';

export interface CtaBlock extends BaseBlock {
  type: 'cta';
  label: string;
  href: string;
  style?: CtaStyle;
}

export interface QuoteBlock extends BaseBlock {
  type: 'quote';
  text: string;
  author?: string;
}

export type VideoProvider = 'youtube' | 'vimeo';

export interface VideoBlock extends BaseBlock {
  type: 'video';
  provider: VideoProvider;
  videoId: string;
}

/**
 * VÍDEO SUBIDO — un vídeo alojado por nosotros, al contrario que `VideoBlock`, que incrusta
 * uno de YouTube o Vimeo. Los dos conviven y son tipos distintos, no un tipo con una
 * bifurcación dentro: no comparten ni un campo.
 *
 * `url` es la URL COMPLETA, nunca la clave: la limpieza de huérfanas del backend recorre el
 * `Json` guardado buscando cadenas que sean direcciones nuestras, así que una clave desnuda
 * la dejaría ciega **en silencio** (ver el DTO del backend). El editor guarda aquí la URL
 * TEMPORAL que devuelve el confirm; el backend la promociona al guardar.
 */
export interface VideoUploadBlock extends BaseBlock {
  type: 'videoUpload';
  url: string;
  poster?: string;
  caption?: string;
}

export interface SeparatorBlock extends BaseBlock {
  type: 'separator';
}

export interface TableBlock extends BaseBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
}

// ── Ráfaga 3 — 4 tipos nuevos ────────────────────────────────────────────────

export interface ImageTextImage {
  url: string;
  alt: string;
  caption?: string;
}

export type ImageTextLayout = 'imageLeft' | 'imageRight';

export interface ImageTextBlock extends BaseBlock {
  type: 'imageText';
  image: ImageTextImage;
  markdown: string;
  layout: ImageTextLayout;
}

export interface StepItem {
  title: string;
  description: string;
  image?: string;
}

export interface StepsBlock extends BaseBlock {
  type: 'steps';
  title?: string;
  items: StepItem[];
}

export interface ProfileImage {
  url: string;
  alt: string;
}

export interface ProfileAttribute {
  label: string;
  value: string;
}

export interface ProfileBlock extends BaseBlock {
  type: 'profile';
  image?: ProfileImage;
  name?: string;
  attributes: ProfileAttribute[];
}

// Primer bloque DINÁMICO — no guarda contenido, guarda una consulta que se
// resuelve contra SearchService.search() en cada render (ver
// ListingsBlockRenderer + la resolución SSR en page.tsx de /paginas y
// /blog). 'recent'/'featured' se mapean a un `sort` de search() en
// lib/api/busqueda — ver el comentario en el DTO del backend.
export const LISTINGS_BLOCK_LIMITS = [4, 6, 8, 12] as const;
export type ListingsBlockLimit = (typeof LISTINGS_BLOCK_LIMITS)[number];
export type ListingsBlockSort = 'recent' | 'featured';

export interface ListingsBlock extends BaseBlock {
  type: 'listings';
  title?: string;
  categorySlug: string;
  limit: ListingsBlockLimit;
  sort?: ListingsBlockSort;
  showAllLink?: boolean;
}

export type Block =
  | TextBlock
  | FaqBlock
  | HubBlock
  | ImageBlock
  | CtaBlock
  | QuoteBlock
  | VideoBlock
  | SeparatorBlock
  | TableBlock
  | ImageTextBlock
  | StepsBlock
  | ProfileBlock
  | ListingsBlock
  | VideoUploadBlock;
