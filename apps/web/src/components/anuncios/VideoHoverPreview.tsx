import { isSafeSrc } from '@/lib/image-domains';

/**
 * PÓSTER ANIMADO P2 — LA PREVISUALIZACIÓN AL PASAR EL RATÓN.
 *
 * LO QUE ES: una capa con `background-image` sobre la foto de portada, que enseña **una
 * imagen fija** —el sprite: los cinco fotogramas del vídeo en una tira— y la anima moviendo
 * la ventana con CSS. **No hay `<video>`, ni `preload`, ni un solo byte de vídeo.** La
 * garantía del diseño de listas se respeta por construcción: con una imagen no se puede
 * montar un reproductor.
 *
 * LA PEREZA, QUE ES LO QUE HACE QUE ESTO SEA BARATO. La URL viaja en el payload de la
 * tarjeta, pero **el elemento sólo se monta al entrar el ratón** (`activo`), y hasta
 * entonces el navegador no pide nada. Es el mismo trato que el carrusel ya hace con las
 * fotos 2ª a Nª y que el documento indexado hace con `images[]`: *«a URL is ~100 bytes vs.
 * the image bytes themselves»*. Sin esto, una página de resultados bajaría 24 sprites que
 * nadie ha pedido.
 *
 * `isSafeSrc` NO ES CEREMONIA. Una `url()` de CSS **no pasa por `remotePatterns`** de
 * `next/image` — igual que un `<video src>`—, así que ésta es su ÚNICA restricción de
 * dominio. Es el mismo cuidado, y por el mismo motivo, que toma `ListingGallery` con la
 * dirección del vídeo.
 *
 * SIN SPRITE NO SE PINTA NADA, y ése es el caso mayoritario: todos los vídeos anteriores a
 * la ráfaga que lo introdujo no tienen previsualización, y no se pueden regenerar en el
 * servidor (haría falta decodificar el vídeo, o sea ffmpeg). La tarjeta se comporta entonces
 * **exactamente como siempre**: portada e indicador. Es un estado normal, no un error.
 *
 * Ver docs/diseno-poster-animado.md §5.
 */
export function VideoHoverPreview({
  /** La URL del sprite. `null`/`undefined` = este anuncio no tiene previsualización. */
  src,
  /** El texto del anuncio, para que la capa no sea un elemento mudo para quien no la ve. */
  title,
  /**
   * ¿Está el ratón encima? **Lo decide quien tiene el contenedor**, no este componente: es
   * lo que permite montar el elemento —y por tanto pedir la imagen— sólo cuando hace falta.
   */
  activo,
}: {
  src?: string | null;
  title: string;
  activo: boolean;
}) {
  if (!activo || !src || !isSafeSrc(src)) return null;

  return (
    <div
      // La animación, el recorte y las dos consultas de medios —`hover: hover` para que
      // esto NO exista en táctil, y `prefers-reduced-motion` para apagarlo— viven en
      // `globals.css`: `steps(5)` y los keyframes de `background-position` no se pueden
      // escribir con utilidades de Tailwind.
      // SIN `bg-cover` ni ninguna utilidad de fondo: `background-size` la fija
      // `.sprite-hover` en `500% 100%`, que es la aritmética de la tira. Una utilidad de
      // Tailwind aquí la pisaría y se vería un fotograma estirado.
      className="sprite-hover pointer-events-none absolute inset-0 z-[5]"
      // La URL es un dato de cada anuncio, así que entra por variable CSS. Ya está validada
      // contra nuestro almacenamiento tres líneas más arriba.
      style={{ '--sprite': `url("${src}")` } as React.CSSProperties}
      data-testid="card-video-preview"
      role="img"
      aria-label={`Previsualización del vídeo de ${title}`}
    />
  );
}
