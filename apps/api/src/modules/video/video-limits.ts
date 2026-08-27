/**
 * Los límites del vídeo Pro. FUENTE ÚNICA — el backend valida contra esto y el frontend
 * (ráfaga siguiente) los mostrará leyéndolos de aquí vía la API, no copiándolos.
 *
 * VIVEN APARTE DE `MAX_FILE_SIZE` (media.service.ts, 10 MB) A PROPÓSITO. Ese número protege
 * a las FOTOS, y subirlo para que quepa un vídeo dejaría también a las fotos sin techo. Dos
 * tipos de media con pesos que se diferencian en dos órdenes de magnitud no pueden compartir
 * un solo límite.
 */

/** 50 MB. Es el límite DURO: viaja dentro de la firma, así que el almacenamiento lo aplica. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/**
 * 60 segundos.
 *
 * ES EL LÍMITE QUE MÁS PROTEGE, y no por el peso —de eso ya se ocupa el de arriba— sino
 * porque acota el tiempo de subida desde un móvil con datos, que es donde la experiencia se
 * rompe de verdad.
 *
 * FRONTERA CONOCIDA Y ACEPTADA: a diferencia del tamaño, la duración NO se puede imponer
 * desde el servidor sin leer el fichero, y este diseño no trae ffmpeg a propósito. Se valida
 * la duración DECLARADA por el cliente. Un cliente manipulado podría declarar 30 s y subir
 * un vídeo de cinco minutos a bajo bitrate que quepa en 50 MB.
 *
 * Por qué se acepta: el daño está acotado por el tamaño —que sí es infranqueable—, así que
 * lo que se escapa es un límite de PRODUCTO, no de coste ni de seguridad. Cerrarlo del todo
 * exigiría parsear las cajas MP4 del fichero subido (o ffmpeg), y ninguna de las dos cosas
 * vale lo que cuesta para impedir que alguien tenga un vídeo más largo en su propio anuncio.
 */
export const MAX_VIDEO_DURATION_SECONDS = 60;

/**
 * Solo MP4/H.264. NO es una restricción arbitraria: es lo que hace innecesaria la
 * transcodificación, que es la pieza más cara del proyecto. Un móvil actual graba
 * exactamente en este formato y todos los navegadores lo reproducen, así que lo que llega ya
 * es reproducible sin tocarlo.
 *
 * Ampliar esta lista (WebM, MOV…) NO es gratis: reabre la decisión de transcodificar.
 */
export const ALLOWED_VIDEO_MIME_TYPES = ['video/mp4'] as const;

/** Ventana de validez de la URL prefirmada. Corta: es un permiso para subir, no un enlace. */
export const VIDEO_UPLOAD_URL_TTL_SECONDS = 10 * 60;

/** Setting (requisito 1) — interruptor de admin de toda la feature. Sin fila, apagada. */
export const VIDEO_ENABLED_SETTING = 'videoEnabled';

/** Prefijo de las claves de vídeo en el almacenamiento, separado de las imágenes. */
export const VIDEO_KEY_PREFIX = 'listing-videos';

// ---------------------------------------------------------------------------
//  PÓSTER ANIMADO P1 — el sprite
// ---------------------------------------------------------------------------

/**
 * Prefijo del SPRITE. **Propio, y las dos exclusiones son el diseño.**
 *
 * NO `listing-videos/`, aunque el sprite pertenezca al vídeo: ese prefijo es la cadena
 * literal que el barrido e2e busca para dar por rota la garantía del cero-bytes-en-listas
 * (`video-visualizacion.e2e-spec.ts`). Meter ahí una imagen que **sí** debe poder viajar a
 * las tarjetas pondría ese test en rojo por un motivo falso — y peor, invitaría a relajarlo.
 * **El prefijo es la frontera, y la frontera se respeta.**
 *
 * NO `media/`: ése lo puebla `POST /media/upload`, que crea una fila en `ListingImage` y
 * encola `sharp`. Un sprite no es una foto de anuncio: no tiene por qué existir como fila, y
 * la miniatura de 800 px que `ImageProcessor` le generaría no la usaría nadie.
 *
 * Ver docs/diseno-poster-animado.md §3.2.
 */
export const PREVIEW_KEY_PREFIX = 'listing-previews';

/**
 * 512 KB. **Dos órdenes de magnitud por debajo del vídeo y uno por debajo de las fotos**
 * (10 MB, `media.service.ts`), y no por prudencia: un sprite de cinco fotogramas de 320×180
 * pesa entre 20 y 45 KB. Uno que supere el medio mega no es un sprite grande, es un sprite
 * mal hecho — o algo que no es un sprite.
 *
 * Como el del vídeo, viaja DENTRO de la firma: el almacenamiento rechaza un cuerpo de otro
 * tamaño, así que el límite deja de depender de que el cliente diga la verdad.
 */
export const MAX_PREVIEW_BYTES = 512 * 1024;

/**
 * WebP o JPEG. Los dos salen de `canvas.toBlob`, los dos son **imágenes fijas** y los dos
 * están ya en el `MIME_TO_EXT` del camino de imágenes.
 *
 * NINGÚN FORMATO ANIMADO EN ESTA LISTA, y es deliberado: `image/gif` aquí convertiría el
 * artefacto en algo que anima solo, siempre y en todas partes — y con eso se perderían de
 * golpe el control del hover y la decisión del móvil. Ver la barrera B-8.
 */
export const ALLOWED_PREVIEW_MIME_TYPES = ['image/webp', 'image/jpeg'] as const;

/** La extensión que le toca a cada tipo. Mismo mapa que el camino de imágenes. */
export const PREVIEW_MIME_TO_EXT: Record<string, string> = {
  'image/webp': '.webp',
  'image/jpeg': '.jpg',
};

/**
 * LA GEOMETRÍA DEL SPRITE —cuántos fotogramas, de qué tamaño y en qué instantes— **NO vive
 * aquí, vive en el cliente** (`apps/web/src/lib/api/video.ts`).
 *
 * Y no es un descuido: el servidor **no la usa para nada**. No captura, no valida las
 * dimensiones (leerlas exigiría descargar el sprite, y los bytes de media no pasan por esta
 * API) y no la publica. Sus dos únicos consumidores —quien dibuja los fotogramas y el CSS
 * que los animará en P2— están **los dos** en el frontend. Ponerla aquí y «publicarla» por
 * `/video/config` sería inventar un lector único de mentira: un dato que viaja de un sitio
 * que no lo mira a otro que ya lo tenía.
 *
 * Lo que sí es del servidor está arriba: el prefijo, el tope de bytes y los tipos admitidos
 * — que son exactamente las tres cosas que la firma tiene que hacer cumplir.
 */

/** Lo que la API publica para que el cliente valide ANTES de empezar a subir. */
export interface VideoLimits {
  maxBytes: number;
  maxDurationSeconds: number;
  allowedMimeTypes: string[];
}

export const VIDEO_LIMITS: VideoLimits = {
  maxBytes: MAX_VIDEO_BYTES,
  maxDurationSeconds: MAX_VIDEO_DURATION_SECONDS,
  allowedMimeTypes: [...ALLOWED_VIDEO_MIME_TYPES],
};
