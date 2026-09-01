import { isSafeSrc } from '@/lib/image-domains';

/**
 * EL REPRODUCTOR DE VÍDEO — uno, para las dos superficies que lo montan.
 *
 * Había dos `<video>` escritos a mano —la ficha pública y la del backoffice— y **habían
 * divergido en las dos cosas que importan**:
 *
 *  1. **`preload`.** La ficha llevaba `preload="none"`; el backoffice, nada — es decir, el
 *     `auto` del navegador. La auditoría lo anotó como «divergencia probablemente
 *     deliberada» (§2.4), y al mirarlo de cerca no lo era: el argumento a favor de
 *     precargar («el moderador ha ido ahí a mirar») no se sostiene, porque la ficha del
 *     backoffice se abre para MIL cosas —cambiar el estado, leer denuncias, mirar la IP— y
 *     el vídeo es una de ellas. Precargar megabytes en cada apertura para servir a las
 *     veces que sí venía a verlo es el mismo cálculo que la ficha pública ya resolvió al
 *     revés. `preload="none"` para los dos.
 *  2. **La validación de origen.** La ficha comprobaba `isSafeSrc`; el backoffice pintaba
 *     `data.videoUrl` en crudo. Y ésta es la divergencia de verdad importante: un
 *     `<video src>` **no pasa por `remotePatterns` de next/image**, así que esa
 *     comprobación es la única barrera de dominio que el vídeo tiene en el cliente. El
 *     backoffice se la estaba saltando.
 *
 * Con un componente, las dos dejan de poder separarse: no hay dónde escribir el segundo
 * `<video>`. Es el mismo movimiento que `VideoIndicator` hizo con el indicador.
 *
 * NO ES EL INDICADOR DE LAS LISTAS. Esto monta un elemento de vídeo de verdad y sólo debe
 * usarse donde hay UNO —una ficha, un bloque de contenido—, nunca en una parrilla. El
 * contrato de cero bytes en listas lo mantiene `VideoIndicator`, que no conoce la dirección.
 *
 * VÍDEO DE BLOQUE V2 — MUDADO AQUÍ DESDE `components/anuncios/`, sin tocar una línea de su
 * cuerpo. El bloque `videoUpload` del blog, las páginas y la portada monta exactamente este
 * reproductor, así que vivir en la carpeta de anuncios había pasado a ser una etiqueta
 * falsa: el componente recibe una dirección y un póster y no pregunta de dónde vienen. Es la
 * reutilización limpia que `docs/diseno-video-bloque.md` §5.1 identificó —al revés que el
 * servicio de subida, que sí necesitaba camino propio (§2)—, y por eso se muda en vez de
 * copiarse: dos `<video>` volverían a divergir en `preload` y en la validación de origen,
 * que es justo lo que este componente nació para impedir.
 */
export function VideoPlayer({
  src,
  poster,
  className,
  testId = 'ficha-video',
}: {
  src: string;
  poster?: string | null;
  className?: string;
  testId?: string;
}) {
  // Si la dirección no es de nuestro almacenamiento, no se monta NADA. Devolver `null` y
  // no un reproductor roto: un dato antiguo o manipulado no debe pintar un hueco con
  // controles que no llevan a ninguna parte.
  if (!isSafeSrc(src)) return null;

  const posterSeguro = poster && isSafeSrc(poster) ? poster : undefined;

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      src={src}
      poster={posterSeguro}
      controls
      /* LA DECISIÓN DE RENDIMIENTO, ahora en un solo sitio. «Abrir un anuncio» no es
         «descargar el vídeo»: el coste de que un anuncio tenga vídeo es UNA IMAGEN MÁS
         —el póster— hasta que alguien pulsa play. `controls` sin `autoPlay`: reproducir
         es siempre un acto de quien mira. */
      preload="none"
      playsInline
      className={className}
      data-testid={testId}
    />
  );
}
