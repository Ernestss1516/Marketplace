import {
  FileText,
  HelpCircle,
  LayoutGrid,
  ImageIcon,
  MousePointerClick,
  Quote as QuoteIcon,
  Video as VideoIcon,
  Minus,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import { generateId } from '@/lib/utils';
import type { Block } from '@/types/blocks';

export type BlockType = Block['type'];

// Nombres y descripciones en lenguaje claro (NO jerga técnica) — es el
// requisito central del editor: un admin no técnico debe entender qué hace
// cada bloque sin adivinar qué significa "faq" o "cta".
export const BLOCK_TYPE_META: Record<BlockType, { label: string; description: string; icon: LucideIcon }> = {
  text: { label: 'Texto', description: 'Párrafos con formato: negrita, listas, enlaces', icon: FileText },
  faq: { label: 'Preguntas frecuentes', description: 'Lista de preguntas que se despliegan al hacer clic', icon: HelpCircle },
  hub: { label: 'Enlaces relacionados', description: 'Tarjetas con enlaces a otras páginas', icon: LayoutGrid },
  image: { label: 'Imagen', description: 'Una foto con texto alternativo y pie de foto opcional', icon: ImageIcon },
  cta: { label: 'Botón destacado', description: 'Un botón grande que lleva a otra página', icon: MousePointerClick },
  quote: { label: 'Cita', description: 'Una frase destacada, con autor opcional', icon: QuoteIcon },
  video: { label: 'Vídeo', description: 'Un vídeo incrustado de YouTube o Vimeo', icon: VideoIcon },
  separator: { label: 'Separador', description: 'Una línea divisoria entre secciones', icon: Minus },
  table: { label: 'Tabla', description: 'Una tabla de filas y columnas', icon: Table2 },
};

// Orden fijo del selector — de más simple/frecuente a más elaborado, no
// alfabético (ayuda a un admin no técnico a no sentirse abrumado).
export const BLOCK_TYPE_ORDER: BlockType[] = [
  'text',
  'image',
  'cta',
  'quote',
  'faq',
  'hub',
  'video',
  'table',
  'separator',
];

// Valores por defecto al añadir un bloque nuevo — id fresco vía generateId()
// (lib/utils.ts, ya existente). faq/hub/table arrancan con un sub-ítem/fila
// ya creados porque el backend exige mínimo 1 (ArrayMinSize(1)) — mejor que
// el admin vea el hueco a rellenar a que reciba un 400 con un array vacío.
export function createDefaultBlock(type: BlockType): Block {
  const id = generateId();
  switch (type) {
    case 'text':
      return { id, type, markdown: '' };
    case 'faq':
      return { id, type, items: [{ question: '', answer: '' }] };
    case 'hub':
      return { id, type, links: [{ label: '', href: '' }] };
    case 'image':
      return { id, type, url: '', alt: '' };
    case 'cta':
      return { id, type, label: '', href: '' };
    case 'quote':
      return { id, type, text: '' };
    case 'video':
      return { id, type, provider: 'youtube', videoId: '' };
    case 'separator':
      return { id, type };
    case 'table':
      return { id, type, headers: ['Columna 1'], rows: [['']] };
  }
}

/** True si un bloque ya tiene contenido introducido (para pedir confirmación al borrar). */
export function blockHasContent(block: Block): boolean {
  switch (block.type) {
    case 'text':
      return block.markdown.trim().length > 0;
    case 'faq':
      return block.items.some((i) => i.question.trim() || i.answer.trim());
    case 'hub':
      return block.links.some((l) => l.label.trim() || l.href.trim());
    case 'image':
      return block.url.trim().length > 0;
    case 'cta':
      return block.label.trim().length > 0 || block.href.trim().length > 0;
    case 'quote':
      return block.text.trim().length > 0;
    case 'video':
      return block.videoId.trim().length > 0;
    case 'separator':
      return false;
    case 'table':
      return block.rows.some((row) => row.some((cell) => cell.trim().length > 0));
  }
}
