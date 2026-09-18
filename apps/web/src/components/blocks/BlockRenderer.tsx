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
import { VideoUploadBlockRenderer } from './VideoUploadBlockRenderer';
import { AdBannerBlockRenderer } from './AdBannerBlockRenderer';
import { CookiePreferencesBlockRenderer } from './CookiePreferencesBlockRenderer';


// Switch exhaustivo: si se añade un 17º tipo de bloque sin su `case` aquí, el
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
    case 'videoUpload':
      return <VideoUploadBlockRenderer block={block} />;
    case 'adBanner':
      return <AdBannerBlockRenderer block={block} />;
    case 'separator':
      return <SeparatorBlockRenderer />;
    case 'cookiePreferences':
      return <CookiePreferencesBlockRenderer />;
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
//
// ── `empty:hidden`: EL BLOQUE QUE NO SE PINTA TAMPOCO OCUPA ──────────────────
//
// Cuatro renderizadores pueden devolver `null` —publicidad con imagen de dominio
// no permitido, imagen igual, `listings` sin datos o con categoría vacía—, y el
// envoltorio de su bloque se montaba igual: un `<div>` vacío dentro del
// `space-y-[var(--ritmo-bloques)]`.
//
// EN MEDIO ESO NO SE NOTA, y merece decirse porque invita a «arreglar» de más: el
// `<div>` vacío se auto-colapsa y su margen se funde con el del hermano
// siguiente, así que 64 y 64 dan 64. Donde no hay hermano con quien fundirse es
// AL FINAL: ahí el margen se escapa del contenedor y separa los bloques de lo que
// venga detrás. Inyectado en las páginas reales: **+64 px** en la portada y en
// /paginas/[slug], **+16 px** en un post del blog (ahí lo que sigue tiene margen
// propio y absorbe el resto), y **+0 px** en medio en las tres.
// docs/diagnostico-hueco-banner-invisible.md §2.2.
//
// EL ENVOLTORIO NO SE PUEDE QUITAR (que sería lo obvio): `TextBlockRenderer`
// devuelve `<MarkdownBody>`, que rinde VARIOS hermanos. Sin el `<div>`, el
// `space-y-*` metería 64 px entre cada párrafo del artículo.
//
// Y no puede decidirlo React: el padre no sabe si el hijo devolverá `null` sin
// renderizarlo —`renderBlock` devuelve `<AdBannerBlockRenderer/>`, no su
// resultado—. `:empty` lo pregunta DESPUÉS, en el mismo pintado y no en un
// efecto, así que no hay salto que reservar ni que quitar.
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
    <div className="space-y-[var(--ritmo-bloques)]">
      {blocks.map((block) => (
        <div key={block.id} className="empty:hidden">
          {renderBlock(block, listingsData, categories)}
        </div>
      ))}
    </div>
  );
}
