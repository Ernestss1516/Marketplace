import type { QuoteBlock } from '@/types/blocks';

export function QuoteBlockRenderer({ block }: { block: QuoteBlock }) {
  return (
    <blockquote className="border-l-4 border-primary/40 pl-4 italic text-muted-foreground">
      <p className="text-lg">&ldquo;{block.text}&rdquo;</p>
      {block.author && <footer className="mt-2 text-sm not-italic">— {block.author}</footer>}
    </blockquote>
  );
}
