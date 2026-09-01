import { apiFetch } from './client';
// VÍDEO DE BLOQUE V2 — `putToStorage` y `captureVideoPoster` vivían aquí y se han mudado a
// `lib/media/upload.ts`: son genéricas (un fichero y una dirección, cero dominio) y ahora las
// usa también el editor del bloque `videoUpload`. Ni una línea de su cuerpo ha cambiado.
import { putToStorage } from '@/lib/media/upload';

/**
 * Vídeo Pro — el cliente del flujo de subida PREFIRMADO.
 *
 * LA COREOGRAFÍA, en tres pasos y en este orden:
 *   1. FIRMAR   — se piden los metadatos al API, que valida (Pro, flag, límites) y devuelve
 *                 un permiso de subida acotado.
 *   2. SUBIR    — el navegador hace el PUT **directamente al almacenamiento**. Los bytes no
 *                 pasan por la API en ningún momento.
 *   3. CONFIRMAR— el API comprueba contra el almacenamiento lo que aterrizó y solo entonces
 *                 lo enlaza al anuncio.
 *
 * QUE EL ORDEN SEA ESE ES LO QUE IMPIDE DEJAR EL ANUNCIO A MEDIAS: el vídeo queda marcado en
 * el paso 3, después de una subida completa. Si algo falla antes, el anuncio sigue
 * exactamente como estaba y lo único que queda es un objeto huérfano que nadie referencia.
 */

export interface VideoConfig {
  enabled: boolean;
  maxBytes: number;
  maxDurationSeconds: number;
  allowedMimeTypes: string[];
}

export interface PresignedUpload {
  uploadUrl: string;
  key: string;
  expiresInSeconds: number;
  requiredHeaders: Record<string, string>;
}

export interface VideoConfirmResult {
  id: string;
  slug: string;
  videoUrl: string | null;
  videoPosterUrl: string | null;
  /** PÓSTER ANIMADO P1 — el sprite. `null` si no se pudo capturar o subir. */
  videoPreviewUrl: string | null;
  hasVideo: boolean;
}

export function getVideoConfig(token: string) {
  return apiFetch<VideoConfig>('/video/config', { token, cache: 'no-store' });
}

export function createVideoUploadUrl(
  token: string,
  body: { listingId: string; contentType: string; sizeBytes: number; durationSeconds: number },
) {
  return apiFetch<PresignedUpload>('/video/upload-url', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
}

/**
 * PÓSTER ANIMADO P1 — la firma del SPRITE. Hermana de `createVideoUploadUrl`, mismo permiso
 * acotado y mismo gate (flag + Pro + anuncio propio y activo).
 */
export function createPreviewUploadUrl(
  token: string,
  body: { listingId: string; contentType: string; sizeBytes: number },
) {
  return apiFetch<PresignedUpload>('/video/preview-url', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
}

export function confirmVideo(
  token: string,
  listingId: string,
  body: { key: string; durationSeconds: number; posterUrl?: string; previewKey?: string },
) {
  return apiFetch<VideoConfirmResult>(`/video/listings/${listingId}/confirm`, {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
}

export function removeVideo(token: string, listingId: string) {
  return apiFetch<{ hasVideo: boolean }>(`/video/listings/${listingId}`, {
    method: 'DELETE',
    token,
  });
}

// ---------------------------------------------------------------------------
// Lo que solo el navegador puede hacer
// ---------------------------------------------------------------------------

export interface VideoFileInfo {
  durationSeconds: number;
  width: number;
  height: number;
}

/**
 * Lee la duración REAL del fichero antes de subir nada.
 *
 * ES LA ÚNICA CAPA QUE PUEDE MEDIRLA. El servidor no lee el fichero —no traemos ffmpeg a
 * propósito— así que valida la duración DECLARADA; aquí se declara lo que el navegador
 * acaba de medir. Ninguna de las dos es infalible por separado: esta la puede saltar un
 * cliente manipulado, y la del servidor confía en el número. Juntas cubren lo que importa,
 * que es el caso honesto y el error accidental —subir sin querer un vídeo de cinco minutos—.
 *
 * Rechazar aquí también evita hacer esperar a alguien cinco minutos de subida para un «no».
 */
export function readVideoFileInfo(file: File): Promise<VideoFileInfo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';

    const limpiar = () => URL.revokeObjectURL(url);

    video.onloadedmetadata = () => {
      const info = {
        durationSeconds: Math.round(video.duration),
        width: video.videoWidth,
        height: video.videoHeight,
      };
      limpiar();
      // Un fichero que no es vídeo puede cargar metadatos con duración infinita o NaN.
      if (!Number.isFinite(info.durationSeconds) || info.durationSeconds <= 0) {
        reject(new Error('No hemos podido leer la duración del vídeo.'));
        return;
      }
      resolve(info);
    };
    video.onerror = () => {
      limpiar();
      reject(new Error('Ese fichero no parece un vídeo que podamos reproducir.'));
    };

    video.src = url;
  });
}

// ---------------------------------------------------------------------------
//  PÓSTER ANIMADO P1 — el SPRITE
// ---------------------------------------------------------------------------

/**
 * LA GEOMETRÍA DEL SPRITE, y vive aquí porque **sus dos únicos consumidores están aquí**:
 * quien dibuja los fotogramas (abajo) y el CSS que los animará en P2. El servidor no captura,
 * no mide y no valida dimensiones —leerlas exigiría descargar el sprite, y los bytes de media
 * no pasan por la API—, así que ponerlas allí y «publicarlas» sería un lector único de
 * mentira.
 *
 * CINCO FOTOGRAMAS, y no cuatro ni seis: cuatro se lee como un parpadeo, y seis paga un 20 %
 * más de peso por un fotograma que a ~4 fps nadie distingue. El bucle dura 1,25 s, que es más
 * o menos lo que un ratón se queda quieto sobre una tarjeta antes de decidir.
 *
 * Si este número cambiara, los sprites viejos **no se animan mal: se quedan quietos**, porque
 * el CSS de P2 lee esta misma constante. Un sprite de cinco animado como si fuera de seis es
 * el estado que no debe poder existir — por eso es una constante del proyecto y no un dato
 * por fila.
 */
export const PREVIEW_FRAMES = 5;

/** Cada fotograma, 16:9. La tira mide entonces 1600 × 180. */
export const PREVIEW_FRAME_WIDTH = 320;
export const PREVIEW_FRAME_HEIGHT = 180;

/**
 * Los instantes, como fracción de la duración: el intervalo `[10 %, 90 %]` y **no** `[0, d]`.
 *
 * Los extremos de un vídeo de móvil son casi siempre negro, una mano moviéndose o el suelo. Y
 * el 10 % inicial evita además el fotograma en negro que muchos `.mp4` traen antes del primer
 * keyframe — el mismo motivo por el que `captureVideoPoster` captura en el segundo 1 y no en
 * el 0.
 */
export const PREVIEW_FRAME_POSITIONS = [0.1, 0.3, 0.5, 0.7, 0.9];

/**
 * Plazo máximo de la captura entera. `captureVideoPoster` hace UN `seek`; cinco encadenados
 * sobre un fichero grande en un móvil viejo pueden no terminar nunca si el decodificador se
 * atasca, y entonces el vendedor se quedaría mirando «Comprobando el vídeo…» para siempre.
 * Al vencer se rinde con `null`, que es un estado normal (ver abajo).
 */
const SPRITE_TIMEOUT_MS = 10_000;

/**
 * ¿Sabe este navegador emitir WebP desde un canvas?
 *
 * HAY QUE PREGUNTARLO, no intentarlo: `toBlob(cb, 'image/webp')` **no falla** donde no se
 * soporta — la especificación dice que caiga a **PNG**, en silencio. Y un PNG de cinco
 * fotogramas fotográficos pesa varios cientos de KB: el peor resultado posible, sin que nadie
 * se entere. Así que se emite un canvas de 1 × 1 y se mira el `type` de lo que sale.
 */
async function soportaWebp(): Promise<boolean> {
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const tipo = await new Promise<string | null>((resolve) => {
      probe.toBlob((b) => resolve(b?.type ?? null), 'image/webp', 0.75);
    });
    return tipo === 'image/webp';
  } catch {
    return false;
  }
}

/**
 * Captura el SPRITE: `PREVIEW_FRAMES` fotogramas del vídeo, uno al lado del otro, en **UNA
 * SOLA IMAGEN FIJA**.
 *
 * ES EL MISMO CUERPO QUE `captureVideoPoster` CON UN BUCLE ALREDEDOR — `<video>` oculto →
 * `currentTime` → `onseeked` → `drawImage` → `toBlob` — y eso no es una casualidad feliz: es
 * **la razón de que el artefacto sea un sprite y no un WebP animado**. `canvas.toBlob()` sólo
 * emite imágenes fijas, y no existe ninguna API nativa que empaquete una animación; hacerlo
 * exigiría traer un codificador al navegador —cientos de KB de JavaScript para fabricar
 * decenas de KB de dato—, que es la misma dependencia que este proyecto rechazó dos veces en
 * el servidor.
 *
 * Y de que sea fijo salen gratis dos cosas: la animación se controla desde CSS (así que se
 * puede animar SÓLO en hover, cosa que un `<img>` animado no permite: anima solo y siempre),
 * y si algo va mal lo que queda es un fotograma — una imagen legítima, no un fichero roto.
 *
 * DEVUELVE `null` ANTE CUALQUIER PROBLEMA, exactamente como `captureVideoPoster`. Sin sprite
 * se vive: la tarjeta se comporta como hoy. **Un vídeo que no se deja capturar no puede
 * impedir que se suba el vídeo.**
 *
 * Ver docs/diseno-poster-animado.md §2.
 */
export function captureVideoSprite(
  file: File,
  durationSeconds: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    let terminado = false;
    const acabar = (blob: Blob | null) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    const temporizador = setTimeout(() => acabar(null), SPRITE_TIMEOUT_MS);

    // UN SOLO canvas del tamaño de la tira entera: cada fotograma se dibuja desplazado. No
    // hay N canvas ni N blobs que juntar después — juntar imágenes ya codificadas es
    // justamente lo que no se puede hacer sin un codificador.
    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_FRAME_WIDTH * PREVIEW_FRAMES;
    canvas.height = PREVIEW_FRAME_HEIGHT;
    const ctx = canvas.getContext('2d');

    let i = 0;

    const instante = (n: number) => {
      const t = durationSeconds * PREVIEW_FRAME_POSITIONS[n];
      // Un vídeo más corto que el instante pedido: se coge lo que haya. Misma defensa que
      // `captureVideoPoster` para su único `seek`.
      return Math.min(t, Math.max(0, video.duration - 0.1));
    };

    video.onloadedmetadata = () => {
      if (!ctx || !video.videoWidth || !video.videoHeight) return acabar(null);
      video.currentTime = instante(0);
    };

    video.onseeked = () => {
      try {
        if (!ctx) return acabar(null);

        /**
         * RECORTE «cover» A MANO. Un vídeo de móvil suele ser vertical (9:16) y el hueco es
         * 16:9: encajarlo entero lo dejaría con dos bandas negras enormes. Se recorta al
         * centro, que es la misma decisión que la tarjeta ya toma con las fotos
         * (`object-cover`).
         */
        const escala = Math.max(
          PREVIEW_FRAME_WIDTH / video.videoWidth,
          PREVIEW_FRAME_HEIGHT / video.videoHeight,
        );
        const anchoOrigen = PREVIEW_FRAME_WIDTH / escala;
        const altoOrigen = PREVIEW_FRAME_HEIGHT / escala;

        ctx.drawImage(
          video,
          (video.videoWidth - anchoOrigen) / 2,
          (video.videoHeight - altoOrigen) / 2,
          anchoOrigen,
          altoOrigen,
          i * PREVIEW_FRAME_WIDTH,
          0,
          PREVIEW_FRAME_WIDTH,
          PREVIEW_FRAME_HEIGHT,
        );

        i += 1;
        if (i < PREVIEW_FRAMES) {
          video.currentTime = instante(i);
          return;
        }

        // Todos dibujados: una única codificación de la tira entera.
        void soportaWebp().then((webp) => {
          if (terminado) return;
          canvas.toBlob(
            (blob) => acabar(blob),
            webp ? 'image/webp' : 'image/jpeg',
            webp ? 0.75 : 0.7,
          );
        });
      } catch {
        acabar(null);
      }
    };

    video.onerror = () => acabar(null);
    video.src = url;
  });
}

/**
 * Sube el sprite por su camino prefirmado y devuelve la CLAVE temporal, o `undefined`.
 *
 * DEVUELVE LA CLAVE Y NO UNA URL, al revés que `uploadPoster`: el sprite aterriza todavía en
 * `tmp/` y es el `confirm` quien lo saca de ahí — igual que el `.mp4`. El póster, en cambio,
 * llega ya en su sitio por el camino de imágenes.
 *
 * **NUNCA LANZA.** Es la mitad cliente de la garantía B-4: si la firma o el PUT fallan, el
 * vídeo se confirma igual y la columna queda `null`. Molde exacto de `uploadPoster`, que ya
 * traga su propio error por la misma razón.
 */
export async function uploadSprite(
  token: string,
  listingId: string,
  blob: Blob,
): Promise<string | undefined> {
  try {
    const firma = await createPreviewUploadUrl(token, {
      listingId,
      contentType: blob.type,
      sizeBytes: blob.size,
    });
    await putToStorage(firma.uploadUrl, blob, firma.requiredHeaders);
    return firma.key;
  } catch {
    return undefined;
  }
}

/** Sube el póster por el camino de IMÁGENES, que ya existe y valida el origen. */
export async function uploadPoster(token: string, blob: Blob): Promise<string | undefined> {
  const form = new FormData();
  form.append('file', blob, 'poster.jpg');
  try {
    const res = await apiFetch<{ url: string }>('/media/upload', {
      method: 'POST',
      token,
      body: form,
    });
    return res.url;
  } catch {
    // Sin póster se puede vivir (la ficha cae a la foto de portada); sin vídeo no.
    return undefined;
  }
}

/** Mensaje de por qué un fichero no vale, o `null` si vale. Rechazo TEMPRANO. */
export function validateVideoFile(file: File, config: VideoConfig): string | null {
  if (!config.allowedMimeTypes.includes(file.type)) {
    return 'Solo admitimos vídeo MP4. Es lo que graba tu móvil por defecto.';
  }
  if (file.size > config.maxBytes) {
    const mb = Math.round(config.maxBytes / (1024 * 1024));
    return `El vídeo pesa demasiado. El máximo son ${mb} MB.`;
  }
  return null;
}
