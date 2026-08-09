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
