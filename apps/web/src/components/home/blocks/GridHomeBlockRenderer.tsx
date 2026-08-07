import type { GridColumns, HomeGridBlock, HomeGridCell } from '@/types/home-blocks';
import { SmartLink } from '@/components/shared/SmartLink';
import { isSafeSrc } from '@/lib/image-domains';
import { HOME_ICONS } from '../home-icons';

/**
 * Rejilla de tarjetas. **Server Component, cero JS.**
 *
 * Cubre de una vez los dos huérfanos de la portada escrita a mano: las cuatro
 * señales de confianza (icono + texto, sin enlace) y cualquier rejilla de
 * imágenes enlazadas.
 */

/**
 * Clases ESTÁTICAS, nunca `sm:grid-cols-${n}`: Tailwind purga lo que no ve
 * escrito en el código, así que una clase interpolada simplemente no existiría
 * en el CSS final. Es también el motivo de que las columnas sean un conjunto
 * cerrado {1,2,3,4,6} y no un rango.
 */
const COLUMN_CLASS: Record<GridColumns, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  6: 'grid-cols-3 sm:grid-cols-6',
};

function CellMedia({ media }: { media: NonNullable<HomeGridCell['media']> }) {
  if (media.kind === 'icon') {
    const Icon = HOME_ICONS[media.name];
    return <Icon className="h-6 w-6 text-primary" aria-hidden="true" />;
  }

  // Guarda de render, aunque el backend ya validó al guardar: si la URL no está
  // cubierta por `remotePatterns`, se degrada a NO pintar la imagen en vez de
  // dejar un roto. A diferencia del bloque `image` del blog —que desaparece
  // entero—, aquí la celda SIGUE mostrándose con su texto: en una rejilla, un
  // hueco rompe la maquetación (docs/diseno-portada.md §7).
  if (!isSafeSrc(media.url)) return null;

  return (
    // <img> plano y no next/image: el bloque no guarda dimensiones, así que no
    // hay width/height que darle. Mismo criterio que ImageBlockRenderer.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={media.url} alt={media.alt} className="h-16 w-16 rounded-lg object-cover" />
  );
}

function CellBody({ cell }: { cell: HomeGridCell }) {
  return (
    <>
      {cell.media && <CellMedia media={cell.media} />}
      <span className="text-sm font-medium">{cell.title}</span>
      {cell.description && (
        <span className="text-xs text-muted-foreground">{cell.description}</span>
      )}
    </>
  );
}

export function GridHomeBlockRenderer({ block }: { block: HomeGridBlock }) {
  const cellCls = 'flex flex-col items-center gap-2 text-center';

  return (
    <div>
      {block.title && <h2 className="mb-4 text-xl font-semibold">{block.title}</h2>}

      <div className={`grid gap-4 ${COLUMN_CLASS[block.columns]}`}>
        {block.items.map((cell, idx) =>
          cell.href ? (
            // Con enlace, el reparto interno/externo lo resuelve el SmartLink
            // compartido con el blog, el footer y el nav (RP.2).
            <SmartLink
              key={idx}
              href={cell.href}
              className={`${cellCls} rounded-lg border p-4 transition-colors hover:bg-muted/50`}
            >
              <CellBody cell={cell} />
            </SmartLink>
          ) : (
            // Sin enlace NO se pinta un <a> sin destino: las señales de confianza
            // son texto, no navegación.
            <div key={idx} className={cellCls}>
              <CellBody cell={cell} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}
