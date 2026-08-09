import { apiFetch } from './client';

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

export function confirmVideo(
  token: string,
  listingId: string,
  body: { key: string; durationSeconds: number; posterUrl?: string },
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

/**
 * Captura un frame como PÓSTER.
 *
 * Sin póster, el reproductor de la ficha sería un rectángulo negro. Se hace AQUÍ y no en el
 * servidor porque extraer un frame exige ffmpeg, y ffmpeg es justo la dependencia que este
 * proyecto evita: si no se trae para transcodificar, no tiene sentido traerla para esto.
 *
 * ES MANIPULABLE —un cliente modificado podría enviar otra imagen—, y se acepta: es la misma
 * capacidad que ya tiene para subir cualquier foto engañosa a su anuncio, y lo cubre la
 * moderación. Si la captura falla, se sigue sin póster y la ficha usará la foto de portada.
 */
export function captureVideoPoster(file: File, atSecond = 1): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    const rendirse = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    video.onloadedmetadata = () => {
      // Un vídeo más corto que el instante pedido: se coge el principio.
      video.currentTime = Math.min(atSecond, Math.max(0, video.duration - 0.1));
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx || !canvas.width || !canvas.height) return rendirse();
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            resolve(blob);
          },
          'image/jpeg',
          0.8,
        );
      } catch {
        rendirse();
      }
    };

    video.onerror = rendirse;
    video.src = url;
  });
}

/**
 * El PUT contra el almacenamiento, con progreso.
 *
 * `XMLHttpRequest` y no `fetch` a propósito: `fetch` no informa del progreso de SUBIDA, y en
 * un fichero de decenas de megas desde el móvil una barra que no se mueve es indistinguible
 * de una aplicación colgada.
 */
export function putToStorage(
  uploadUrl: string,
  file: Blob,
  headers: Record<string, string>,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      // El almacenamiento rechaza, entre otras cosas, un cuerpo de tamaño distinto al
      // firmado. Ese rechazo es una GARANTÍA funcionando, no un fallo de red.
      else reject(new Error(`La subida falló (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Se ha perdido la conexión durante la subida.'));
    xhr.onabort = () => reject(new Error('Subida cancelada.'));

    xhr.send(file);
  });
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
