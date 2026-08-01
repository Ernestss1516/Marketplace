import type { Block } from '@/types/blocks';
import type { Category } from '@/types';
import type { SearchResponse } from '@/lib/api/busqueda';
import { TextBlockRenderer } from './TextBlockRenderer';
import { FaqBlockRenderer } from './FaqBlockRenderer';
import { HubBlockRenderer } from './HubBlockRenderer';
import { ImageBlockRenderer } from './ImageBlockRenderer';
import { CtaBlockRenderer } from './CtaBlockRenderer';
import { QuoteBlockRenderer } from './QuoteBlockRenderer';
import { VideoBlockRenderer } from './VideoBlockRenderer';
import { SeparatorBlockRenderer } from './SeparatorBlockRenderer';
import { TableBlockRenderer } from './TableBlockRenderer';
import { ImageTextBlockRenderer } from './ImageTextBlockRenderer';
import { StepsBlockRenderer } from './StepsBlockRenderer';
import { ProfileBlockRenderer } from './ProfileBlockRenderer';
import { ListingsBlockRenderer } from './ListingsBlockRenderer';

// Switch exhaustivo: si se añade un 14º tipo de bloque sin su `case` aquí, el
// `never` de `assertUnreachable` falla en build — el compilador ES la
// validación de que el esquema y el renderizador nunca divergen.
function assertUnreachable(block: never): never {
  throw new Error(`Tipo de bloque no soportado: ${JSON.stringify(block)}`);
}

// `listingsData`: resultados de search() ya resueltos, uno por bloque
// `listings` (clave = block.id). BlockRenderer sigue siendo síncrono (lo
// comparten la página pública SSR y el preview client-side del editor) — la
// resolución async vive fuera, en quien llama. Ver ListingsBlockRenderer.
// `categories`: árbol de categorías, solo lo consume el bloque `listings` para
// construir la URL canónica de su "Ver todos" (A1 — ver ListingsBlockRenderer).
// Opcional: sin él ese enlace cae a la URL plana, que el catch-all redirige.
function renderBlock(
  block: Block,
  listingsData?: Record<string, SearchResponse>,
  categories?: Category[],
) {
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
    case 'imageText':
      return <ImageTextBlockRenderer block={block} />;
    case 'steps':
      return <StepsBlockRenderer block={block} />;
    case 'profile':
      return <ProfileBlockRenderer block={block} />;
    case 'listings':
      return (
        <ListingsBlockRenderer
          block={block}
          data={listingsData?.[block.id]}
          categories={categories}
        />
      );
    default:
      return assertUnreachable(block);
  }
}

// Sustituye a <MarkdownBody body={post.body} /> en /blog/[slug] y
// /paginas/[slug]. Cada bloque se envuelve en su propio contenedor con
// espaciado vertical consistente — los renderizadores individuales no se
// preocupan del ritmo entre bloques.
export function BlockRenderer({
  blocks,
  listingsData,
  categories,
}: {
  blocks: Block[];
  listingsData?: Record<string, SearchResponse>;
  categories?: Category[];
}) {
  return (
    <div className="space-y-8">
      {blocks.map((block) => (
        <div key={block.id}>{renderBlock(block, listingsData, categories)}</div>
      ))}
    </div>
  );
}
