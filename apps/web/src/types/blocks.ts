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

export interface SeparatorBlock extends BaseBlock {
  type: 'separator';
}

export interface TableBlock extends BaseBlock {
  type: 'table';
  headers: string[];
  rows: string[][];
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
  | TableBlock;
