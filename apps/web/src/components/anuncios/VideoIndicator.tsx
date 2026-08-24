import { Play } from 'lucide-react';

/**
 * «ESTE ANUNCIO TIENE VÍDEO» — el indicador, y NADA MÁS.
 *
 * LO QUE ES: un SVG del bundle sobre la foto de siempre. Cero peticiones, cero bytes de
 * vídeo. No hay `<video>`, ni `preload`, ni póster que sustituya a la foto, y no es una
 * omisión que haya que recordar: a este componente **sólo le llega el hecho de que hay
 * vídeo**, nunca la dirección. Sin dirección no hay nada que descargar.
 *
 * Es la garantía del diseño de listas: una página pinta del orden de veinte a cuarenta
 * tarjetas, y montar veinte elementos de vídeo —aunque fuera sólo para leer metadatos— son
 * veinte descargas antes de que el usuario decida nada. Un vídeo web pesa uno o dos órdenes
 * de magnitud más que una de estas fotos.
 *
 * POR QUÉ ES UN COMPONENTE Y NO MARCADO SUELTO. Estaba escrito a mano dentro de
 * `CardPhotoCarousel`, así que las superficies que NO pasan por ese carrusel —la tarjeta de
 * «Mis anuncios» y las dos del mapa— no tenían indicador aunque recibían el booleano. La
 * salida no era copiarlo tres veces: cuatro copias del mismo `<span>` son cuatro sitios
 * donde el icono, el texto o el `data-testid` pueden separarse. Ahora hay uno.
 *
 * Ver docs/auditoria-pro-video.md §2.3 (huecos V-2 y V-3).
 */
export function VideoIndicator({
  /** Dónde se coloca dentro del contenedor `relative` de quien lo usa. */
  className = 'bottom-2 right-2',
  /**
   * Sin la palabra «Vídeo», sólo el icono. Para miniaturas donde la píldora completa no
   * cabe —la del mapa mide 56 px y el texto se saldría—. Es el MISMO indicador y el mismo
   * `data-testid`: lo que cambia es cuánto espacio ocupa, no qué dice.
   */
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span
      // `pointer-events-none`: la tarjeta entera sigue siendo un enlace al anuncio, y el
      // indicador no puede robarle el clic.
      className={`pointer-events-none absolute z-10 flex items-center gap-1 rounded-full bg-black/65 text-white ${
        compact ? 'p-1' : 'px-2 py-0.5 text-[11px] font-medium'
      } ${className}`}
      data-testid="card-tiene-video"
      // Con la píldora, el texto ya lo dice. En compacto no hay texto, así que el nombre
      // accesible tiene que venir de aquí o el indicador no existiría para un lector.
      {...(compact ? { role: 'img', 'aria-label': 'Tiene vídeo' } : {})}
    >
      <Play className="h-3 w-3 fill-current" aria-hidden />
      {!compact && 'Vídeo'}
    </span>
  );
}
