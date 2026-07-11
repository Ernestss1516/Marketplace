import type { Block } from '@/types/blocks';
import { TextBlockRenderer } from './TextBlockRenderer';
import { FaqBlockRenderer } from './FaqBlockRenderer';
import { HubBlockRenderer } from './HubBlockRenderer';
import { ImageBlockRenderer } from './ImageBlockRenderer';
import { CtaBlockRenderer } from './CtaBlockRenderer';
import { QuoteBlockRenderer } from './QuoteBlockRenderer';
import { VideoBlockRenderer } from './VideoBlockRenderer';
import { SeparatorBlockRenderer } from './SeparatorBlockRenderer';
import { TableBlockRenderer } from './TableBlockRenderer';

// Switch exhaustivo: si se añade un 10º tipo de bloque sin su `case` aquí, el
// `never` de `assertUnreachable` falla en build — el compilador ES la
// validación de que el esquema y el renderizador nunca divergen.
function assertUnreachable(block: never): never {
  throw new Error(`Tipo de bloque no soportado: ${JSON.stringify(block)}`);
}

function renderBlock(block: Block) {
  switch (block.type) {
    case 'text':
      return <TextBlockRenderer block={block} />;
    case 'faq':
      return <FaqBlockRenderer block={block} />;
    case 'hub':
      return <HubBlockRenderer block={block} />;
    case 'image':
      return <ImageBlockRenderer block={block} />;
    case 'cta':
      return <CtaBlockRenderer block={block} />;
    case 'quote':
      return <QuoteBlockRenderer block={block} />;
    case 'video':
      return <VideoBlockRenderer block={block} />;
    case 'separator':
      return <SeparatorBlockRenderer />;
    case 'table':
      return <TableBlockRenderer block={block} />;
    default:
      return assertUnreachable(block);
  }
}

// Sustituye a <MarkdownBody body={post.body} /> en /blog/[slug] y
// /paginas/[slug]. Cada bloque se envuelve en su propio contenedor con
// espaciado vertical consistente — los renderizadores individuales no se
// preocupan del ritmo entre bloques.
export function BlockRenderer({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-8">
      {blocks.map((block) => (
        <div key={block.id}>{renderBlock(block)}</div>
      ))}
    </div>
  );
}
