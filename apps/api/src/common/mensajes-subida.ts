/**
 * i18n T5 — LOS MENSAJES DE SUBIDA, EN ESPAÑOL Y EN UN SOLO SITIO.
 *
 * ── QUÉ RESUELVE, y por qué es dos defectos y no uno ─────────────────────────────────────
 *
 * `File type not allowed. Use JPEG, PNG or WebP.` estaba escrito **a mano diez veces**
 * (blog ×2, portada ×2, media ×4, patrocinados ×2) y `No file provided` **seis**. Los dos
 * problemas viajaban juntos:
 *
 *  1. **Estaban en inglés**, y éstos SÍ se ven: son endpoints de admin, y el backoffice pinta
 *     `err.message` tal cual en 112 sitios (`auditoria-i18n-espanol.md` §7.2). Es el mensaje
 *     que un humano se encuentra más veces por semana de todo el backend.
 *  2. **Estaban duplicados.** Diez copias de una frase son diez sitios donde cambiarla, y el
 *     día que se cambien nueve el admin lee dos textos distintos para el mismo rechazo — que
 *     es exactamente la divergencia que T3 cerró en el vocabulario del frontend.
 *
 * Traducir sin consolidar habría dejado el segundo defecto vivo, y con la traducción recién
 * hecha habría sido el mejor momento para que apareciera.
 *
 * ── POR QUÉ UN CONSTRUCTOR Y NO UNA CONSTANTE SUELTA ────────────────────────────────────
 *
 * Porque los formatos admitidos **no son los mismos en todas partes**: las imágenes de
 * contenido admiten JPEG/PNG/WebP y los logos admiten además SVG (`branding.constants.ts`,
 * que ya tenía su propio mensaje único por esta misma razón). Con una constante habría dos
 * frases parecidas otra vez; con un constructor hay **una frase y dos listas**, que es donde
 * está la diferencia de verdad.
 */

/**
 * «El formato no está admitido; usa …».
 *
 * `formatos` se escribe tal y como se lee, no como se llama el MIME: quien sube un fichero
 * piensa en «JPEG», no en `image/jpeg`.
 */
export function tipoDeFicheroNoAdmitido(formatos: string): string {
  return `Formato de fichero no admitido. Usa ${formatos}.`;
}

/** Imágenes de contenido: anuncios, blog, portada, patrocinados, avatares. */
export const IMAGEN_TIPO_NO_ADMITIDO = tipoDeFicheroNoAdmitido('JPEG, PNG o WebP');

/**
 * No llegó fichero en la petición.
 *
 * Es un fallo de la petición, no del fichero, y por eso el texto no habla de formatos: sale
 * cuando el `multipart` viene sin la parte esperada (un formulario mal montado, o una subida
 * cancelada a medias).
 */
export const SIN_FICHERO = 'No se ha enviado ningún fichero.';
