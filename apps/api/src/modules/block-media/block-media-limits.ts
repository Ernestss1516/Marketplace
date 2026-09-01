/**
 * Los límites del VÍDEO DE BLOQUE (contenido editorial). FUENTE ÚNICA.
 *
 * FICHERO PROPIO, Y NO IMPORTA NADA DE `video-limits.ts` — a propósito, aunque dos de sus
 * números coincidan hoy con los del vídeo Pro. **Dos valores que coinciden no son el mismo
 * valor**: si mañana el vídeo de anuncios sube a 100 MB por una decisión de producto de
 * anuncios, el vídeo editorial **no** debe seguirle en silencio. Compartir la constante
 * crearía un lector único de mentira — un dato que viaja de un sitio que no decide a otro
 * que ya decidía por su cuenta.
 *
 * Ver `docs/diseno-video-bloque.md` §6.
 */

/**
 * 50 MB. Es el límite DURO y el ÚNICO infranqueable: viaja **dentro de la firma**
 * (`R2Service.presignUpload` pone `ContentLength`), así que lo aplica el almacenamiento y
 * no la buena fe del cliente. Un PUT con un cuerpo de otro tamaño es rechazado por R2.
 */
export const MAX_BLOCK_VIDEO_BYTES = 50 * 1024 * 1024;

/**
 * Solo MP4/H.264. NO es una restricción arbitraria: es lo que hace innecesaria la
 * transcodificación, que es la pieza que este dominio entero evita traer. Todos los
 * navegadores lo reproducen sin tocarlo.
 *
 * Ampliar esta lista (WebM, MOV…) reabre esa decisión.
 */
export const ALLOWED_BLOCK_VIDEO_MIME_TYPES = ['video/mp4'] as const;

/**
 * NO HAY LÍMITE DE DURACIÓN, y la ausencia es la decisión.
 *
 * El vídeo Pro tiene 60 s, y su propio comentario dice para qué: *«acota el tiempo de
 * subida desde un móvil con datos, que es donde la experiencia se rompe de verdad»*. Un
 * EDITOR en el backoffice no es ese caso.
 *
 * Y hay un motivo más fuerte: la duración **no se puede comprobar en el servidor** sin
 * parsear las cajas MP4 o traer ffmpeg, así que allí se valida la duración *declarada* por
 * el cliente — una frontera conocida y aceptada. Poner aquí otro número (120 s, 180 s)
 * sería un límite que no protege de nada y que el servidor **finge** imponer: el daño ya lo
 * acota `MAX_BLOCK_VIDEO_BYTES`, que sí es infranqueable.
 *
 * Si algún día se quiere una guía de producto, su sitio es un aviso en el editor, no una
 * regla de aquí.
 */

/**
 * 512 KB para el PÓSTER. Dos órdenes de magnitud por debajo del vídeo: un fotograma de
 * 1280×720 en WebP pesa decenas de KB. Uno que pase de medio mega no es un póster grande,
 * es otra cosa. Viaja dentro de la firma igual que el del vídeo.
 */
export const MAX_BLOCK_POSTER_BYTES = 512 * 1024;

/**
 * WebP o JPEG. Los dos salen de `canvas.toBlob` (el póster se captura en el cliente: sacar
 * un fotograma en servidor exige ffmpeg) y los dos son imágenes fijas.
 *
 * Ningún formato animado en la lista: un póster que anima solo, siempre y en todas partes,
 * es otro artefacto y otra decisión.
 */
export const ALLOWED_BLOCK_POSTER_MIME_TYPES = ['image/webp', 'image/jpeg'] as const;

/** La extensión que le toca a cada tipo de póster. */
export const BLOCK_POSTER_MIME_TO_EXT: Record<string, string> = {
  'image/webp': '.webp',
  'image/jpeg': '.jpg',
};

/** La extensión del vídeo. Una sola, porque un solo MIME admitido. */
export const BLOCK_VIDEO_EXT = '.mp4';

/**
 * Prefijo de las claves del media de bloque. **Las dos exclusiones son el diseño:**
 *
 * NO `listing-videos/`: esa cadena literal es lo que busca el barrido de
 * `video-visualizacion.e2e-spec.ts` para dar por rota la garantía de «cero bytes de vídeo
 * en listas». Meter aquí vídeo editorial pondría ese test en rojo por un motivo falso —y
 * peor, invitaría a relajarlo—. Mismo razonamiento con el que el sprite se ganó su propio
 * prefijo (`video-limits.ts`, `PREVIEW_KEY_PREFIX`). **El prefijo es la frontera.**
 *
 * NO `blocks/`: ése lo puebla `uploadBlockImage` y es de imágenes. Un `.mp4` de 50 MB
 * dentro dejaría ese prefijo sin poder tener nunca una regla pensada para imágenes.
 *
 * EL VÍDEO Y SU PÓSTER COMPARTEN RAÍZ a propósito: así **una sola** regla de ciclo de vida
 * sobre `blocks-videos/tmp/` recoge los dos abandonos, y el pase de promoción los mueve a
 * los dos con el mismo recorrido, sin una línea extra.
 */
export const BLOCK_MEDIA_KEY_PREFIX = 'blocks-videos';

/** Ventana de validez de la URL prefirmada. Corta: es un permiso para subir, no un enlace. */
export const BLOCK_MEDIA_UPLOAD_URL_TTL_SECONDS = 10 * 60;
