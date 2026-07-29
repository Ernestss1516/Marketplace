/**
 * Atención al usuario R5 — validación de CLIENTE de los adjuntos.
 *
 * **REFLEJA la del backend; no la sustituye.** Mismo principio que el resto del
 * sistema: la UI RESTRINGE, el backend GARANTIZA. Estos límites están aquí para
 * que el usuario sepa *antes* de esperar una subida de 10 MB que el fichero no
 * vale, no para decidir si vale: el servicio responde 422 igual si se fuerza la
 * petición, y esos códigos se traducen abajo.
 *
 * Los tres números son los de §14.7 y los mismos que `tickets.constants.ts`. Si
 * algún día cambian allí, cambian aquí — están en un solo sitio por lado
 * precisamente para que la copia sea evidente y no aparezca repetida en cada
 * pantalla.
 */
export const ADJUNTOS_MIME_PERMITIDOS = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

/** Para el `accept` del input: extensiones + MIME, que los navegadores mezclan. */
export const ADJUNTOS_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf';

export const ADJUNTOS_MAX_BYTES = 10 * 1024 * 1024;
export const ADJUNTOS_MAX_POR_MENSAJE = 5;

/** Tamaño legible para las etiquetas del hilo. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Devuelve el motivo por el que la selección no vale, o `null` si vale.
 *
 * Un solo mensaje y no una lista: el usuario corrige de uno en uno, y enumerar
 * cinco problemas a la vez no le ayuda a arreglar el primero.
 */
export function validarAdjuntos(files: File[]): string | null {
  if (files.length === 0) return null;

  if (files.length > ADJUNTOS_MAX_POR_MENSAJE) {
    return `Puedes adjuntar como máximo ${ADJUNTOS_MAX_POR_MENSAJE} ficheros.`;
  }

  for (const file of files) {
    if (!(ADJUNTOS_MIME_PERMITIDOS as readonly string[]).includes(file.type)) {
      return `«${file.name}» no es un tipo admitido. Solo imágenes JPG, PNG o WebP y ficheros PDF.`;
    }
    if (file.size > ADJUNTOS_MAX_BYTES) {
      return `«${file.name}» ocupa demasiado. El máximo por fichero es ${formatBytes(ADJUNTOS_MAX_BYTES)}.`;
    }
  }

  return null;
}

/**
 * Traduce los `code` de adjunto que devuelve el backend. Se usa junto con los
 * traductores de errores de ticket ya existentes, que cubren el resto.
 */
export function toAdjuntoMessage(code: string | undefined): string | null {
  switch (code) {
    case 'TOO_MANY_ATTACHMENTS':
      return `Puedes adjuntar como máximo ${ADJUNTOS_MAX_POR_MENSAJE} ficheros por mensaje.`;
    case 'ATTACHMENT_TYPE_NOT_ALLOWED':
      return 'Solo se admiten imágenes JPG, PNG o WebP y ficheros PDF.';
    case 'ATTACHMENT_TOO_LARGE':
      return `Cada fichero puede ocupar como máximo ${formatBytes(ADJUNTOS_MAX_BYTES)}.`;
    default:
      return null;
  }
}
