import type { ImageBlock } from '@/types/blocks';
import { isSafeSrc } from '@/lib/image-domains';

const POSITION_CLS: Record<NonNullable<ImageBlock['position']>, string> = {
  left: 'mr-auto',
  center: 'mx-auto',
  right: 'ml-auto',
  full: 'w-full',
};

// <img> plano, no next/image: el bloque no guarda dimensiones (solo un hint
// de `width` en %), así que no hay forma de fijar width/height/aspect-ratio
// que next/image necesita — mismo patrón ya usado en PostForm.tsx para el
// preview de coverUrl. isSafeSrc() (mismo guard que el cover de /blog/[slug])
// evita pintar una URL que no sea de nuestro storage, aunque en teoría ya la
// bloqueó la validación del backend al guardar.
export function ImageBlockRenderer({ block }: { block: ImageBlock }) {
  if (!isSafeSrc(block.url)) return null;

  const position = block.position ?? 'center';

  return (
    <figure className={POSITION_CLS[position]} style={block.width ? { width: `${block.width}%` } : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={block.url} alt={block.alt} className="w-full rounded-lg" />
      {block.caption && (
        <figcaption className="mt-2 text-center text-sm text-muted-foreground">{block.caption}</figcaption>
      )}
    </figure>
  );
}
