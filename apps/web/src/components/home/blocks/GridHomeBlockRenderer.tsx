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
 *
 * `auto-rows-fr` (ajuste 6): todas las filas miden lo mismo, así que una tarjeta con
 * descripción larga no deja a sus vecinas flotando a media altura. Va aquí, junto a las
 * columnas, porque es la otra mitad de «que la rejilla cuadre».
 */
const COLUMN_CLASS: Record<GridColumns, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  6: 'grid-cols-3 sm:grid-cols-6',
};

function CellMedia({ media }: { media: HomeGridCell['media'] }) {
  if (media.kind === 'icon') {
    // El icono NO se estira al ancho de la tarjeta: se centra en una caja de la misma
    // altura que la de una imagen para que una rejilla mixta no dé saltos, pero conserva su
    // tamaño. Estirarlo habría cambiado la pinta de las señales de confianza, que llevan
    // así desde RP.4 y no son lo que este ajuste venía a arreglar.
    const Icon = HOME_ICONS[media.name];
    return (
      <span className="flex h-16 w-full items-center justify-center">
        <Icon className="h-8 w-8 text-primary" aria-hidden="true" />
      </span>
    );
  }

  // Guarda de render, aunque el backend ya validó al guardar: si la URL no está
  // cubierta por `remotePatterns`, se degrada a NO pintar la imagen en vez de
  // dejar un roto. A diferencia del bloque `image` del blog —que desaparece
  // entero—, aquí la celda SIGUE mostrándose con su texto: en una rejilla, un
  // hueco rompe la maquetación (docs/diseno-portada.md §7).
  if (!isSafeSrc(media.url)) return null;

  return (
    // AJUSTE 6 — la imagen ocupa el ANCHO de la tarjeta con una proporción FIJA, en vez del
    // cuadrado de 64 px de antes. Las dos cosas resuelven el mismo problema: con `aspect-[4/3]
    // object-cover`, dos imágenes de tamaños distintos ocupan exactamente la misma caja y la
    // rejilla no se descuadra — el recorte lo hace el navegador, no el editor.
    //
    // Clases estáticas, igual que las columnas: `aspect-[4/3]` está escrito literal y Tailwind
    // lo ve. Un `aspect-[${ratio}]` calculado no existiría en el CSS final.
    //
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={media.url}
      alt={media.alt}
      className="aspect-[4/3] w-full rounded-lg object-cover"
    />
  );
}

function CellBody({ cell }: { cell: HomeGridCell }) {
  return (
    <>
      {/* `media` es obligatorio desde el ajuste 6, pero una portada guardada ANTES puede
          traer celdas sin él: endurecer el esquema no reescribe lo guardado. Se comprueba,
          o la portada entera reventaría al pintar. */}
      {cell.media && <CellMedia media={cell.media} />}

      {/* SIN TÍTULO NO SE RESERVA SITIO. Antes esto se pintaba siempre, así que una tarjeta
          sin texto dejaba un `<span>` vacío ocupando una línea — el hueco que el ajuste 6
          viene a quitar. Con el `<span>` condicional, el `gap` del flex tampoco se aplica:
          un hueco no existe si no existe el elemento. */}
      {cell.title && <span className="text-sm font-medium">{cell.title}</span>}

      {cell.description && (
        <span className="text-xs text-muted-foreground">{cell.description}</span>
      )}
    </>
  );
}

export function GridHomeBlockRenderer({ block }: { block: HomeGridBlock }) {
  // `h-full` + `auto-rows-fr` en la rejilla: la tarjeta ocupa toda su fila, así que las
  // vecinas quedan alineadas arriba Y abajo, tengan o no descripción.
  const cellCls = 'flex h-full flex-col items-center gap-2 text-center';

  return (
    <div>
      {block.title && <h2 className="mb-4 text-xl font-semibold">{block.title}</h2>}

      <div className={`grid auto-rows-fr gap-4 ${COLUMN_CLASS[block.columns]}`}>
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
