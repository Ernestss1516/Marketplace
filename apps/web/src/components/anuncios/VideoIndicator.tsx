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
 * ─── Y DESDE LA PREVIA EN MÓVIL, TAMBIÉN ES EL BOTÓN ────────────────────────────
 *
 * En táctil no hay hover, así que la previsualización animada del vídeo no existía en el
 * dispositivo mayoritario (`docs/diagnostico-previa-video-movil.md`). El disparador elegido fue
 * el toque, y **el affordance no hubo que inventarlo: ya estaba aquí**. Un icono de *play*
 * sobre una imagen es, en un teléfono, la invitación a tocar más reconocible que existe; lo que
 * faltaba era hacerla real.
 *
 * SÓLO CUANDO SE LE PASA `onActivar`. Sin ese manejador sigue siendo el `<span>` inerte de
 * siempre — que es lo que tiene que ser en las tres superficies que NO tienen sprite que
 * enseñar (Mis anuncios, las dos del mapa y la tabla del backoffice): un botón que al tocarlo
 * no hace nada es peor que no tener botón.
 *
 * Ver docs/auditoria-pro-video.md §2.3 (huecos V-2 y V-3) y docs/diagnostico-previa-video-movil.md §4.
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
  /**
   * FLECO #13 — EN LÍNEA, no superpuesto.
   *
   * Todas las superficies anteriores pintan el indicador SOBRE una foto, así que era
   * `absolute` sin discusión. La tabla de `/admin/anuncios` no tiene foto: es texto, y
   * una píldora flotante dentro de una celda quedaría colgando de la nada.
   *
   * La salida NO era escribir un cuarto `<span>` a mano en el backoffice — que es
   * exactamente el defecto que la extracción de este componente vino a cerrar (había tres
   * copias y por eso tres superficies se quedaron sin indicador). Es una posición más del
   * MISMO indicador, con el mismo icono, el mismo texto y el mismo `data-testid`: lo que
   * cambia es dónde se apoya, igual que `compact` cambia cuánto ocupa.
   */
  inline = false,
  /**
   * PREVIA EN MÓVIL — qué hacer al tocarlo. **Su presencia es lo que convierte el indicador en
   * un botón**; sin él, todo lo de abajo se comporta exactamente como antes.
   */
  onActivar,
  /** ¿Está la previa encendida ahora mismo? Sólo para el estado accesible (`aria-pressed`). */
  activa = false,
}: {
  className?: string;
  compact?: boolean;
  inline?: boolean;
  onActivar?: () => void;
  activa?: boolean;
}) {
  const esBoton = onActivar !== undefined;

  /**
   * LAS MISMAS CLASES VISUALES EN LOS DOS CAMINOS, y eso es una barrera, no una comodidad: la
   * píldora tiene que verse **idéntica** en escritorio antes y después de este cambio, o las
   * capturas de referencia se moverían por un motivo que no es el de la ráfaga.
   *
   * Un `<button>` no se ve distinto de un `<span>` con estas clases porque el Preflight de
   * Tailwind ya le normaliza la tipografía (`font-family: inherit`, `font-size: 100%`,
   * `font-weight: inherit`, `padding: 0`), que es lo único que el navegador le habría cambiado.
   */
  const clases = `items-center gap-1 rounded-full ${
    inline
      ? // `inline-flex` y no `flex`: en la celda de una tabla convive con el texto de
        // al lado, y un `flex` a secas lo empujaría a su propia línea.
        'inline-flex bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/80'
      : `flex absolute z-10 bg-black/65 text-white ${
          compact ? 'p-1' : 'px-2 py-0.5 text-[11px] font-medium'
        } ${className}`
  }`;

  const contenido = (
    <>
      <Play className="h-3 w-3 fill-current" aria-hidden />
      {!compact && 'Vídeo'}
    </>
  );

  if (esBoton) {
    return (
      <button
        type="button"
        onClick={(e) => {
          // EL MOLDE DE LAS FLECHAS DEL CARRUSEL, literal (`CardPhotoCarousel.go`): la tarjeta
          // entera es un `<Link>`, así que sin estas dos líneas tocar el indicador navegaría al
          // anuncio en vez de encender la previa — y el usuario vería el gesto «fallar»
          // llevándoselo a otra pantalla.
          e.preventDefault();
          e.stopPropagation();
          onActivar();
        }}
        /**
         * EL ÁREA TÁCTIL, A 44×44 — y por eso está en un pseudo-elemento y no en el padding.
         *
         * La píldora mide unos 52×20 px: es la medida correcta para que quepa sobre una foto de
         * 173 px sin taparla, y **más del doble de estrecha que el mínimo recomendado para un
         * dedo**. Agrandarla con padding arreglaría el gesto rompiendo el diseño de la tarjeta,
         * que es el intercambio que no hay que hacer.
         *
         * `after:-inset-3.5` extiende la zona sensible 14 px en las cuatro direcciones **sin
         * pintar nada**: 52+28 = 80 de ancho y 20+28 = 48 de alto. El pseudo-elemento no tiene
         * fondo, hereda los eventos del botón y no ocupa flujo, así que la píldora se ve
         * exactamente igual que antes.
         *
         * SIN `relative`, Y ESO ES UNA CICATRIZ. La primera versión lo llevaba —el reflejo de
         * «un `::after` absoluto necesita un ancestro posicionado»—, y **descolocó la píldora
         * a la esquina contraria, medio fuera de la tarjeta**: `clases` ya trae `absolute`, y
         * entre dos utilidades de posición gana la que Tailwind emite más tarde en la hoja, no
         * la que se escribe después aquí. `absolute` ya es «posicionado», así que el `::after`
         * se ancla al botón sin ayuda. Lo cazó una CAPTURA, no un test: en jsdom las dos
         * clases conviven tan ricamente.
         *
         * `pointer-events-auto` porque el contenedor del carrusel apaga los eventos de sus
         * capas decorativas; éste es el único hijo que sí tiene que recibirlos.
         */
        className={`${clases} pointer-events-auto after:absolute after:-inset-3.5 after:content-['']`}
        data-testid="card-tiene-video"
        // Lo que el botón HACE, que no es lo mismo que lo que la píldora DICE. El texto
        // «Vídeo» describe el anuncio; esto describe el gesto, que es lo que necesita quien
        // navega sin ver la animación.
        aria-label={activa ? 'Ocultar la previsualización del vídeo' : 'Ver una previsualización del vídeo'}
        aria-pressed={activa}
      >
        {contenido}
      </button>
    );
  }

  return (
    <span
      // `pointer-events-none`: la tarjeta entera sigue siendo un enlace al anuncio, y el
      // indicador —cuando NO es un botón— no puede robarle el clic.
      className={`pointer-events-none ${clases}`}
      data-testid="card-tiene-video"
      // Con la píldora, el texto ya lo dice. En compacto no hay texto, así que el nombre
      // accesible tiene que venir de aquí o el indicador no existiría para un lector.
      {...(compact ? { role: 'img', 'aria-label': 'Tiene vídeo' } : {})}
    >
      {contenido}
    </span>
  );
}
