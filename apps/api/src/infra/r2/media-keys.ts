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

/**
 * HUÉRFANAS H2 — el segmento que marca «esto todavía no está confirmado».
 *
 * VA ARRIBA, JUSTO DEBAJO DE LA RAÍZ, y no es una preferencia de estilo: los filtros de una
 * regla de ciclo de vida son **prefijos literales, sin comodines**. Con la forma
 * `listing-videos/<listingId>/tmp/…` el `tmp` queda detrás de un id variable y no hay
 * prefijo que lo capture — haría falta una regla por anuncio. Con `listing-videos/tmp/…`
 * basta UNA por raíz.
 *
 * Ver `docs/diseno-huerfanas-sin-fila.md` §9.2.
 */
export const PENDING_SEGMENT = 'tmp';

/**
 * El prefijo bajo el que vive lo que espera confirmación de un dueño concreto:
 * `<raiz>/tmp/<dueño>/`.
 *
 * EL DUEÑO ESTÁ EN LA CLAVE A PROPÓSITO: es lo que permite rechazar la confirmación de una
 * subida ajena sin guardar ningún estado entre firmar y confirmar. El vídeo ya lo hacía con
 * el `listingId`; el avatar gana lo mismo con el `userId`.
 */
export function pendingPrefix(raiz: string, dueñoId: string): string {
  return `${raiz}/${PENDING_SEGMENT}/${dueñoId}/`;
}

/** ¿Esta clave está esperando confirmación bajo esa raíz? */
export function isPendingKey(key: string, raiz: string): boolean {
  return key.startsWith(`${raiz}/${PENDING_SEGMENT}/`);
}

/**
 * Profundidad máxima al recorrer un valor. Los bloques reales tienen 3 o 4 niveles;
 * esto sólo impide que un dato inesperado (o una estructura cíclica que Prisma no
 * puede producir pero un futuro `JSON.parse` sí) haga desbordar la pila.
 */
const MAX_PROFUNDIDAD = 12;

/**
 * HUÉRFANAS SIN FILA (H1) — TODAS las URLs NUESTRAS que un valor referencia, mire
 * donde mire.
 *
 * NO ENUMERA CAMPOS, Y ÉSA ES TODA LA IDEA. Las imágenes de bloque viven dentro de
 * `Json` en campos con **nombres distintos según el tipo de bloque** (`imageUrl` en
 * el carrusel de categorías de la portada, `url` en la rejilla y en los bloques
 * `image` / `image-text` / `profile` del blog…). Una lista de campos escrita a mano
 * se queda corta el día que alguien añade un tipo de bloque nuevo, **y se queda
 * corta en silencio**: nadie ve el fichero que dejó de limpiarse.
 *
 * Es el mismo movimiento que hizo el script que midió el bucket (`diseno-borrado.md`
 * §7.1): convertir la fila entera a texto y buscar ahí dentro, en vez de elegir
 * columnas. Y es la contrapartida del vector 1 de §7.6 —dueños escondidos dentro de
 * `Json`—, sólo que aplicada al revés: allí para no borrar de más, aquí para no
 * dejar de ver lo que se soltó.
 *
 * Sólo devuelve URLs **propias** (`keyFromPublicUrl` ≠ `null`). Una URL ajena —un
 * avatar de Google, un enlace externo— no es nuestra y no se toca. Deduplicado.
 */
export function ownUrlsDeep(value: unknown, publicUrlPrefix: string): string[] {
  const urls = new Set<string>();

  const recorrer = (nodo: unknown, profundidad: number): void => {
    if (profundidad > MAX_PROFUNDIDAD || nodo === null || nodo === undefined) return;

    if (typeof nodo === 'string') {
      if (keyFromPublicUrl(nodo, publicUrlPrefix)) urls.add(nodo);
      return;
    }

    if (Array.isArray(nodo)) {
      for (const item of nodo) recorrer(item, profundidad + 1);
      return;
    }

    if (typeof nodo === 'object') {
      for (const item of Object.values(nodo as Record<string, unknown>)) {
        recorrer(item, profundidad + 1);
      }
    }
  };

  recorrer(value, 0);
  return [...urls];
}

/**
 * Las URLs propias que **estaban y ya no están**: lo que la operación acaba de
 * soltar.
 *
 * El diff es entre conjuntos, así que el caso «la misma imagen aparece en dos
 * bloques y sólo se quita uno» se resuelve solo: si sigue en cualquier parte del
 * «después», no está en la diferencia. Lo que este cálculo NO puede saber es si la
 * URL sigue referenciada **desde otro documento** — eso se comprueba contra la base
 * de datos antes de borrar nada (`MediaCleanupService`).
 */
export function releasedUrls(
  before: unknown,
  after: unknown,
  publicUrlPrefix: string,
): string[] {
  const antes = ownUrlsDeep(before, publicUrlPrefix);
  if (antes.length === 0) return [];
  const despues = new Set(ownUrlsDeep(after, publicUrlPrefix));
  return antes.filter((url) => !despues.has(url));
}
