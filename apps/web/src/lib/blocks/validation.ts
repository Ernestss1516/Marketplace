// Validación de cliente para el editor de bloques — espejo de
// apps/api/src/common/validators/safe-url.ts (isSafeContentUrl). Vive
// duplicada a propósito: el backend SIEMPRE revalida (es la fuente de
// verdad de seguridad), esto es solo para dar feedback inmediato en el
// formulario sin esperar el round-trip — "el error debe mostrarse claro
// junto al campo", no un 400 genérico tras enviar.

/** Ruta relativa ("/...") o URL absoluta http/https. Nunca javascript:/data:. */
export function isSafeContentUrl(value: string): boolean {
  if (!value) return false;
  if (value.startsWith('/')) return true;
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

export const SAFE_URL_HINT = 'El enlace debe empezar por "/" (ruta interna) o por "https://" (externo).';

export type VideoProvider = 'youtube' | 'vimeo';

/**
 * Parsea una URL de YouTube o Vimeo pegada por el admin a {provider, videoId}.
 * Nunca se guarda la URL cruda — el backend revalida el formato del videoId
 * de forma independiente (ver VideoBlockDto), así que este parseo es solo
 * para la UX del editor (preview inmediato + mensaje de error claro si la
 * URL no se reconoce), no la fuente de verdad de seguridad.
 */
export function parseVideoUrl(rawUrl: string): { provider: VideoProvider; videoId: string } | null {
  const url = rawUrl.trim();
  if (!url) return null;

  const youtubeMatch = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  if (youtubeMatch) return { provider: 'youtube', videoId: youtubeMatch[1] };

  const vimeoMatch = url.match(/vimeo\.com\/(?:.*\/)?(\d{6,12})/);
  if (vimeoMatch) return { provider: 'vimeo', videoId: vimeoMatch[1] };

  return null;
}
