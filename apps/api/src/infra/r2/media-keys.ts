/**
 * BORRADO B3 — LAS CLAVES DE R2 QUE PERTENECEN A UN ANUNCIO, en un solo sitio.
 *
 * EL DEFECTO QUE CIERRA. Cada imagen subida deja **DOS** objetos en el bucket:
 *
 *   · el original, `media/<hex><ext>`, cuya URL sí se guarda en `ListingImage.url`;
 *   · una miniatura, `media/<hex>-thumb.webp`, que genera `ImageProcessor` y cuya
 *     clave **no se persiste en ninguna columna**: sólo existe como una regla de
 *     derivación escrita dentro de ese procesador.
 *
 * Quien limpiara mirando únicamente la base de datos borraría la mitad de la
 * basura y dejaría la otra mitad para siempre. Y en cuanto la limpieza derive la
 * clave por su cuenta, **la regla vive en dos sitios** y es cuestión de tiempo que
 * diverjan — cambiar el sufijo o el formato en el procesador dejaría huérfanas
 * todas las miniaturas nuevas, en silencio.
 *
 * Por eso la regla se extrae AQUÍ y los dos lados la importan: quien crea la
 * miniatura y quien la borra. Mismo movimiento, y por el mismo motivo, que
 * `infra/redis/cache-keys.ts` con la clave de la ficha.
 *
 * FICHERO PURO, SIN DI: lo importan un procesador de cola y un servicio de
 * dominio, que no se conocen entre sí.
 */

/**
 * La clave de la miniatura que corresponde a un original.
 *
 * **La regla, y la única copia de ella.** Sustituye la extensión por
 * `-thumb.webp`: `media/abc.jpg` → `media/abc-thumb.webp`.
 */
export function thumbKeyFor(originalKey: string): string {
  return originalKey.replace(/\.[^.]+$/, '-thumb.webp');
}

/**
 * La clave de un objeto a partir de su URL pública, o `null` si esa URL no es
 * nuestra.
 *
 * DEVUELVE `null` EN VEZ DE ADIVINAR: una URL ajena —un `avatarUrl` de Google, un
 * enlace externo pegado a mano— no tiene clave en nuestro bucket, y construir una
 * a la fuerza produciría un borrado contra una ruta inventada. Molde exacto de
 * `VideoService.deleteObjectByUrl`, que hace la misma comprobación antes de
 * borrar.
 */
export function keyFromPublicUrl(url: string, publicUrlPrefix: string): string | null {
  const prefijo = publicUrlPrefix.endsWith('/') ? publicUrlPrefix : `${publicUrlPrefix}/`;
  if (!url.startsWith(prefijo)) return null;
  const key = url.slice(prefijo.length);
  return key.length > 0 ? key : null;
}

/** Lo que hay que borrar de R2 cuando desaparece un anuncio. */
export interface ListingMediaRefs {
  imageUrls: string[];
  videoUrl?: string | null;
  videoPosterUrl?: string | null;
}

/**
 * Todas las claves de R2 que pertenecen a un anuncio: por cada imagen, el
 * original **y su miniatura**; más el vídeo y su póster si los hay.
 *
 * SE CALCULA ANTES DE BORRAR LA FILA, y ése es el motivo de que la limpieza reciba
 * claves y no un `listingId`: cuando el trabajo de la cola se ejecute, el anuncio
 * ya no existirá y no habría forma de averiguar qué ficheros eran suyos.
 *
 * El resultado va deduplicado: dos `ListingImage` con la misma URL —posible si
 * alguien reenlaza una imagen— no deben producir dos borrados del mismo objeto.
 */
export function listingMediaKeys(
  refs: ListingMediaRefs,
  publicUrlPrefix: string,
): string[] {
  const keys = new Set<string>();

  for (const url of refs.imageUrls) {
    const key = keyFromPublicUrl(url, publicUrlPrefix);
    if (!key) continue;
    keys.add(key);
    keys.add(thumbKeyFor(key));
  }

  for (const url of [refs.videoUrl, refs.videoPosterUrl]) {
    if (!url) continue;
    const key = keyFromPublicUrl(url, publicUrlPrefix);
    if (key) keys.add(key);
  }

  return [...keys];
}
