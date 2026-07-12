import type { ImageTextBlock } from '@/types/blocks';
import { isSafeSrc } from '@/lib/image-domains';
import { MarkdownBody } from '@/components/blog/MarkdownBody';

// Composición pura de las dos piezas ya existentes: la mitad-imagen replica
// <img> plano de ImageBlockRenderer (mismo motivo: sin dimensiones fijas
// que next/image necesite), la mitad-texto reutiliza MarkdownBody tal cual.
export function ImageTextBlockRenderer({ block }: { block: ImageTextBlock }) {
  const imageFirst = block.layout === 'imageLeft';
  const safeSrc = isSafeSrc(block.image.url);

  const imageEl = safeSrc && (
    <figure>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={block.image.url} alt={block.image.alt} className="w-full rounded-lg" />
      {block.image.caption && (
        <figcaption className="mt-2 text-center text-sm text-muted-foreground">{block.image.caption}</figcaption>
      )}
    </figure>
  );

  const textEl = <MarkdownBody body={block.markdown} />;

  return (
    <div className="grid items-center gap-6 md:grid-cols-2">
      {imageFirst ? (
        <>
          {imageEl}
          {textEl}
        </>
      ) : (
        <>
          <div className="md:order-2">{imageEl}</div>
          <div className="md:order-1">{textEl}</div>
        </>
      )}
    </div>
  );
}
