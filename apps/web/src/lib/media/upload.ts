/**
 * Las dos piezas GENÉRICAS de subir media pesada desde el navegador.
 *
 * VÍDEO DE BLOQUE V2 — MUDADAS AQUÍ DESDE `lib/api/video.ts`, sin tocar su cuerpo. Las dos
 * operan sobre un `File`/`Blob` y una dirección, y **no saben nada de anuncios**: ni de Pro,
 * ni de `listingId`, ni del vídeo de un vendedor. Vivir dentro del cliente del vídeo Pro
 * había pasado a ser una etiqueta falsa en cuanto el editor del bloque `videoUpload` las
 * necesitó igual.
 *
 * ES LA REUTILIZACIÓN LIMPIA, y conviene distinguirla de la que el diseño DESCARTÓ: el
 * *servicio* de subida del backend no se compartió porque su gate y su clave son
 * irreductiblemente distintos (`docs/diseno-video-bloque.md` §2). Esto es lo contrario —
 * funciones puras sobre un fichero, sin ninguna decisión de dominio dentro—, así que
 * copiarlas habría sido duplicar el mecanismo, que es el otro error que el diseño nombra.
 *
 * NO ES UN FICHERO DE `lib/api/`: no habla con nuestra API. Habla con el almacenamiento (el
 * PUT prefirmado) y con el navegador (el `<canvas>`).
 */

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

/**
 * Captura un frame como PÓSTER.
 *
 * Sin póster, el reproductor sería un rectángulo negro —y con `preload="none"`, que es como
 * se monta, ni siquiera hay primer fotograma que enseñar hasta que alguien pulsa play—. Se
 * hace AQUÍ y no en el servidor porque extraer un frame exige ffmpeg, y ffmpeg es justo la
 * dependencia que este proyecto evita: si no se trae para transcodificar, no tiene sentido
 * traerla para esto.
 *
 * ES MANIPULABLE —un cliente modificado podría enviar otra imagen—, y se acepta: es la misma
 * capacidad que ya tiene para subir cualquier foto engañosa, y lo cubre la moderación. Si la
 * captura falla, se sigue sin póster.
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
