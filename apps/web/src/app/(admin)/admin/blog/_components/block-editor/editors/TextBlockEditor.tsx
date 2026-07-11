import type { TextBlock } from '@/types/blocks';
import MarkdownEditorClient from '../../MarkdownEditorClient';

// Reuso directo, cero trabajo nuevo: mismo componente que ya existía para
// Post.body — toolbar con botones B/I/enlace/imagen (el admin hace clic, no
// memoriza sintaxis Markdown), tubería de seguridad intacta
// (preview="edit" fijo, sin rehype-raw — ver el comentario en MarkdownEditor.tsx).
export function TextBlockEditor({
  block,
  onChange,
  token,
  disabled,
}: {
  block: TextBlock;
  onChange: (patch: Partial<TextBlock>) => void;
  token: string;
  disabled?: boolean;
}) {
  return (
    <MarkdownEditorClient
      value={block.markdown}
      onChange={(markdown) => onChange({ markdown })}
      token={token}
      disabled={disabled}
    />
  );
}
