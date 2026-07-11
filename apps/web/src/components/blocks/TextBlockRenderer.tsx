import type { TextBlock } from '@/types/blocks';
import { MarkdownBody } from '@/components/blog/MarkdownBody';

// Reuso directo de la tubería ya auditada (react-markdown + remark-gfm +
// rehype-sanitize, SIN rehype-raw) — cero superficie de seguridad nueva.
export function TextBlockRenderer({ block }: { block: TextBlock }) {
  return <MarkdownBody body={block.markdown} />;
}
