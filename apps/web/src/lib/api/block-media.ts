import { apiFetch } from './client';
import { putToStorage } from '@/lib/media/upload';

/**
 * VÍDEO DE BLOQUE — el cliente del flujo de subida prefirmado del bloque `videoUpload`.
 *
 * UN SOLO MÓDULO PARA LOS TRES CONTEXTOS (blog, páginas y portada), porque V1 dejó **un solo
 * par de rutas** (`/admin/block-media/…`) para los tres. Las imágenes tienen un cliente por
 * superficie (`uploadBlockImage` en `blog-admin.ts`, `uploadHomepageImage` en
 * `homepage-admin.ts`) porque allí lo que se clona son seis líneas y cada una tiene su propio
 * prefijo de almacenamiento; aquí el endpoint es literalmente el mismo, así que dos clientes
 * serían dos nombres para una cosa. Ver `docs/diseno-video-bloque.md` §3.1.
 *
 * LA COREOGRAFÍA, y el paso que NO está:
 *   1. FIRMAR    — el API valida rol, tipo y tamaño, y devuelve un permiso acotado.
 *   2. SUBIR     — el navegador hace el PUT **directo al almacenamiento** (`putToStorage`).
 *                  Los bytes no pasan por la API.
 *   3. CONFIRMAR — el API mira con `head` lo que aterrizó y devuelve su URL.
 *
 * NO HAY PASO 4. La URL que devuelve el confirm es **temporal** (`blocks-videos/tmp/…`) y el
 * editor la guarda tal cual en el bloque: **promocionarla es cosa del backend**, al guardar el
 * post o la portada (V1, `PendingMediaService`). El cliente no copia, no mueve y no compone
 * claves — si lo hiciera, habría dos sitios donde vive la regla de qué es definitivo y cuál
 * gana cuando discrepen. Ver `docs/diseno-video-bloque.md` §4.2.
 */

export interface BlockMediaUploadTicket {
  uploadUrl: string;
  key: string;
  expiresInSeconds: number;
  /** Cabeceras que el PUT DEBE llevar, o la firma no casa. */
  requiredHeaders: Record<string, string>;
}

/**
 * Los límites, copiados del backend a propósito y en un solo sitio del frontal.
 *
 * NO SE PIDEN POR HTTP, al revés que los del vídeo Pro (`GET /video/config`). Aquel los
 * publica porque lleva un **interruptor de admin** que el editor necesita consultar de todas
 * formas, así que los límites viajaban gratis en esa misma respuesta. Aquí no hay interruptor
 * —el gate es el rol—, así que una petición extra por abrir el editor sería una petición para
 * transportar dos números que no cambian.
 *
 * Sirven sólo para el RECHAZO TEMPRANO: quien decide de verdad es el servidor al firmar, y el
 * tamaño además viaja dentro de la firma. Si estos números se quedaran atrás, lo que pasa es
 * que el usuario recibe el «no» un segundo más tarde — nunca que se cuele algo.
 */
export const BLOCK_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const BLOCK_VIDEO_MIME_TYPES = ['video/mp4'];
export const BLOCK_POSTER_MAX_BYTES = 512 * 1024;

export function createBlockVideoUploadUrl(
  token: string,
  body: { contentType: string; sizeBytes: number },
) {
  return apiFetch<BlockMediaUploadTicket>('/admin/block-media/video-url', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
}

export function createBlockPosterUploadUrl(
  token: string,
  body: { contentType: string; sizeBytes: number },
) {
  return apiFetch<BlockMediaUploadTicket>('/admin/block-media/poster-url', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
}

/**
 * Confirma que lo subido es lo autorizado y devuelve su URL — **la temporal**. No mueve nada:
 * el objeto sigue bajo `tmp/` hasta que se guarde el post o la portada.
 */
export function confirmBlockMedia(token: string, key: string) {
  return apiFetch<{ url: string }>('/admin/block-media/confirm', {
    method: 'POST',
    token,
    body: JSON.stringify({ key }),
  });
}

/** Mensaje de por qué un fichero no vale, o `null` si vale. Rechazo TEMPRANO. */
export function validateBlockVideoFile(file: File): string | null {
  if (!BLOCK_VIDEO_MIME_TYPES.includes(file.type)) {
    return 'Solo admitimos vídeo MP4. Es el formato que reproducen todos los navegadores.';
  }
  if (file.size > BLOCK_VIDEO_MAX_BYTES) {
    const mb = Math.round(BLOCK_VIDEO_MAX_BYTES / (1024 * 1024));
    return `El vídeo pesa demasiado. El máximo son ${mb} MB.`;
  }
  return null;
}

/**
 * Sube un fichero por el camino prefirmado y devuelve su URL **temporal**.
 *
 * Reúne los tres pasos porque los tres van SIEMPRE juntos: firmar sin subir deja un permiso
 * sin usar, y subir sin confirmar deja un objeto que nadie ha comprobado. Los dos editores
 * —el del blog y el de la portada— llaman aquí y no repiten la coreografía.
 */
export async function uploadBlockMedia(
  token: string,
  file: Blob,
  kind: 'video' | 'poster',
  onProgress?: (percent: number) => void,
): Promise<string> {
  const firmar = kind === 'video' ? createBlockVideoUploadUrl : createBlockPosterUploadUrl;
  const firma = await firmar(token, { contentType: file.type, sizeBytes: file.size });
  await putToStorage(firma.uploadUrl, file, firma.requiredHeaders, onProgress);
  const { url } = await confirmBlockMedia(token, firma.key);
  return url;
}
