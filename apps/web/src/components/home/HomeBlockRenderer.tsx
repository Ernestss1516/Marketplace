import type { HomeBlock } from '@/types/home-blocks';
import type { Category } from '@/types';
import type { SearchResponse } from '@/lib/api/busqueda';
import type { CardAttributeMap } from '@/components/anuncios/CardAttributesContext';
import { CtaHomeBlockRenderer } from './blocks/CtaHomeBlockRenderer';
import { SearchHomeBlockRenderer } from './blocks/SearchHomeBlockRenderer';
import { GridHomeBlockRenderer } from './blocks/GridHomeBlockRenderer';
import { StepsHomeBlockRenderer } from './blocks/StepsHomeBlockRenderer';
import { ListingsHomeBlockRenderer } from './blocks/ListingsHomeBlockRenderer';
import { CategoryCarouselHomeBlockRenderer } from './blocks/CategoryCarouselHomeBlockRenderer';
import { SearchTableHomeBlockRenderer } from './blocks/SearchTableHomeBlockRenderer';

/**
 * Despachador del motor de bloques de PORTADA. Molde literal de
 * components/blocks/BlockRenderer.tsx (el del blog), con sus dos propiedades:
 *
 *  1. **Síncrono.** Los bloques que necesiten datos externos (RP.5: `listings`)
 *     los recibirán YA RESUELTOS por quien llama, nunca los pedirán aquí. Es lo
 *     que permite que el mismo renderizador sirva al SSR público y al preview
 *     del editor (RP.3), que es client-side.
 *  2. **`switch` exhaustivo con `assertUnreachable`.** El compilador ES la
 *     garantía de que el esquema y el renderizador no divergen.
 *
 * SOBRE EL PUNTO 2 Y LOS TIPOS QUE FALTAN: el `switch` cubre exactamente los
 * tipos que hoy tiene la unión `HomeBlock`, y eso es deliberado — NO se dejan
 * `case` vacíos para los que vendrán. Un `case` stub significa "tipo ya tratado"
 * y desactivaría justo la garantía que se busca. El mecanismo va al revés, y ya
 * se ha visto funcionar: al registrar `grid` y `steps` en RP.4, este fichero
 * dejó de compilar (`assertUnreachable` recibía un `HomeGridBlock` donde espera
 * `never`) hasta que se escribieron sus `case`. Un tipo no registrado tampoco
 * puede llegar aquí desde la BD: el discriminador del backend lo rechaza con 400
 * al guardar (ValidHomeBlocksArray).
 *
 * Ningún bloque conoce su índice, y por eso el hero NO pasa por aquí: es campo
 * propio de la config (docs/diseno-portada.md §2.3).
 */
function assertUnreachable(block: never): never {
  throw new Error(`Tipo de bloque de portada no soportado: ${JSON.stringify(block)}`);
}

/**
 * Todo lo que los bloques necesitan y no pueden pedirse ellos mismos, cargado
 * UNA vez por la página:
 *  - `categories`: el árbol. Lo usan `search`, `categoryCarousel` y el enlace
 *    "Ver todos" de `listings`.
 *  - `listingsData`: resultados de `search()` YA resueltos, uno por bloque
 *    `listings` (clave = id del bloque). Ver lib/home-blocks/resolve-listings.ts.
 *  - `cardAttributeMap`: se calcula una vez con buildCardAttributeMap y lo
 *    consume el provider de atributos de las tarjetas.
 */
interface HomeBlockRendererProps {
  blocks: HomeBlock[];
  categories?: Category[];
  listingsData?: Record<string, SearchResponse>;
  cardAttributeMap?: CardAttributeMap;
}

function renderBlock(block: HomeBlock, props: Omit<HomeBlockRendererProps, 'blocks'>) {
  switch (block.type) {
    case 'cta':
      return <CtaHomeBlockRenderer block={block} />;
    case 'search':
      return <SearchHomeBlockRenderer block={block} categories={props.categories} />;
    case 'grid':
      return <GridHomeBlockRenderer block={block} />;
    case 'steps':
      return <StepsHomeBlockRenderer block={block} />;
    case 'listings':
      return (
        <ListingsHomeBlockRenderer
          block={block}
          data={props.listingsData?.[block.id]}
          categories={props.categories}
          cardAttributeMap={props.cardAttributeMap}
        />
      );
    case 'categoryCarousel':
      return <CategoryCarouselHomeBlockRenderer block={block} categories={props.categories} />;
    case 'searchTable':
      return <SearchTableHomeBlockRenderer block={block} categories={props.categories} />;
    default:
      return assertUnreachable(block);
  }
}

export function HomeBlockRenderer({ blocks, ...props }: HomeBlockRendererProps) {
  // Espaciado vertical uniforme: los renderizadores individuales no se ocupan
  // del ritmo entre bloques. Mismo contenedor que BlockRenderer.tsx:89-93.
  return (
    <div className="space-y-12">
      {blocks.map((block) => (
        <div key={block.id}>{renderBlock(block, props)}</div>
      ))}
    </div>
  );
}
