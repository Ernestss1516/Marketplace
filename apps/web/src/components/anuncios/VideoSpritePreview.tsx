import { isSafeSrc } from '@/lib/image-domains';

/**
 * PÓSTER ANIMADO — LA CAPA DE PREVISUALIZACIÓN. Se enciende al pasar el ratón (escritorio) o
 * al tocar el indicador de vídeo (táctil).
 *
 * SE LLAMABA `VideoHoverPreview` Y LA CLASE `sprite-hover`. El nombre dejó de ser cierto en
 * cuanto apareció el segundo gesto: un fichero que dice «hover» y contiene el camino del tap es
 * la clase de nombre que hace que el siguiente lector busque en el sitio equivocado. Lo que
 * describe el artefacto —un sprite, una previa— sigue siendo cierto con los dos gestos y con
 * los que vengan.
 *
 * LO QUE ES: una capa con `background-image` sobre la foto de portada, que enseña **una imagen
 * fija** —el sprite: los cinco fotogramas del vídeo en una tira— y la anima moviendo la ventana
 * con CSS. **No hay `<video>`, ni `preload`, ni un solo byte de vídeo.** La garantía del diseño
 * de listas se respeta por construcción: con una imagen no se puede montar un reproductor, y
 * eso no cambia por cambiar el disparador.
 *
 * LA PEREZA, QUE ES LO QUE HACE QUE ESTO SEA BARATO. La URL viaja en el payload de la tarjeta,
 * pero **el elemento sólo se monta cuando `activo`**, y hasta entonces el navegador no pide
 * nada. Es el mismo trato que el carrusel ya hace con las fotos 2ª a Nª y que el documento
 * indexado hace con `images[]`: *«a URL is ~100 bytes vs. the image bytes themselves»*. Sin
 * esto, una página de resultados bajaría 24 sprites que nadie ha pedido — 888 KB medidos
 * (`docs/diagnostico-previa-video-movil.md` §2, opción A).
 *
 * `isSafeSrc` NO ES CEREMONIA. Una `url()` de CSS **no pasa por `remotePatterns`** de
 * `next/image` — igual que un `<video src>`—, así que ésta es su ÚNICA restricción de dominio.
 * Es el mismo cuidado, y por el mismo motivo, que toma `ListingGallery` con la dirección del
 * vídeo. Vale para los dos gestos: el tap entra por aquí igual que el hover.
 *
 * SIN SPRITE NO SE PINTA NADA, y ése es el caso mayoritario: todos los vídeos anteriores a la
 * ráfaga que lo introdujo no tienen previsualización, y no se pueden regenerar en el servidor
 * (haría falta decodificar el vídeo, o sea ffmpeg). La tarjeta se comporta entonces
 * **exactamente como siempre**: portada e indicador. Es un estado normal, no un error.
 *
 * Ver docs/diseno-poster-animado.md §5 y docs/diagnostico-previa-video-movil.md §3.
 */

/**
 * ¿Hay un sprite que se pueda enseñar?
 *
 * EXPORTADA PORQUE HAY **DOS** DECISIONES QUE DEPENDEN DE LA MISMA RESPUESTA: si se pinta la
 * capa (aquí) y si el indicador de vídeo se vuelve tocable (`CardPhotoCarousel`). Escribir la
 * condición dos veces sería el camino a una tarjeta con un botón que, al tocarlo, no enseña
 * nada — el gesto fallido que un usuario no perdona porque no tiene forma de saber qué pasó.
 *
 * Incluye `isSafeSrc` a propósito: un sprite de un dominio ajeno no es un sprite utilizable,
 * es uno que no se va a pintar. Quien pregunte «¿lo enseño?» tiene que recibir esa respuesta
 * completa, no una a medias que le obligue a acordarse del resto.
 */
export function spriteUtilizable(src?: string | null): src is string {
  return !!src && isSafeSrc(src);
}

export function VideoSpritePreview({
  /** La URL del sprite. `null`/`undefined` = este anuncio no tiene previsualización. */
  src,
  /** El texto del anuncio, para que la capa no sea un elemento mudo para quien no la ve. */
  title,
  /**
   * ¿Hay que enseñarla? **Lo decide quien tiene el contenedor**, no este componente: es lo que
   * permite montar el elemento —y por tanto pedir la imagen— sólo cuando hace falta.
   */
  activo,
  /**
   * ¿Se encendió POR UN TOQUE? Cambia **quién anima**, no qué se pinta.
   *
   * Con el ratón, la animación la dispara `.group:hover` desde el CSS, que vive tras
   * `@media (hover: hover) and (pointer: fine)`. Un dedo nunca satisface esa consulta —ésa es
   * la razón entera de que la previa no existiera en móvil—, así que el tap necesita una regla
   * propia, y este atributo es lo que la selecciona.
   *
   * EL ATRIBUTO Y NO UNA CLASE MÁS: `data-tap` dice *por qué* está encendida, que es
   * justamente lo que un test puede leer para distinguir los dos caminos. Con una clase
   * suelta, «encendida por hover» y «encendida por tap» serían indistinguibles en el DOM.
   */
  porTap = false,
}: {
  src?: string | null;
  title: string;
  activo: boolean;
  porTap?: boolean;
}) {
  if (!activo || !spriteUtilizable(src)) return null;

  return (
    <div
      // La animación, el recorte y las dos consultas de medios —`hover: hover` para el ratón,
      // y `prefers-reduced-motion` para apagarlo todo— viven en `globals.css`: `steps(5)` y los
      // keyframes de `background-position` no se pueden escribir con utilidades de Tailwind.
      // SIN `bg-cover` ni ninguna utilidad de fondo: `background-size` la fija
      // `.sprite-previa` en `500% 100%`, que es la aritmética de la tira. Una utilidad de
      // Tailwind aquí la pisaría y se vería un fotograma estirado.
      className="sprite-previa pointer-events-none absolute inset-0 z-[5]"
      // La URL es un dato de cada anuncio, así que entra por variable CSS. Ya está validada
      // contra nuestro almacenamiento por `spriteUtilizable`, tres líneas más arriba.
      style={{ '--sprite': `url("${src}")` } as React.CSSProperties}
      // Sólo cuando el gesto fue un toque. Ausente en el camino del ratón, que ya tiene su
      // propia regla y no debe depender de esto para nada.
      {...(porTap ? { 'data-tap': 'true' } : {})}
      data-testid="card-video-preview"
      role="img"
      aria-label={`Previsualización del vídeo de ${title}`}
    />
  );
}
