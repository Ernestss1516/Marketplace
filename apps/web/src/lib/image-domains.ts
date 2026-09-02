/**
 * DESPLIEGUE GRUPO A — LOS DOMINIOS DE LOS QUE SE PUEDE CARGAR UN MEDIO.
 *
 * ── EL DEFECTO QUE CIERRA ────────────────────────────────────────────────────────────────
 *
 * Esta lista declaraba `*.r2.cloudflarestorage.com`, que es **el endpoint de la API S3 de
 * R2** — por ahí se sube, no por ahí se sirve. Un bucket público de R2 se sirve desde
 * `pub-<hash>.r2.dev` o desde un dominio propio, y ninguno de los dos casa con ese patrón.
 * O sea que en producción `next/image` habría rechazado el dominio y **todas las imágenes del
 * sitio habrían fallado con la red funcionando perfectamente**. Ver
 * docs/auditoria-despliegue.md §3.4.
 *
 * De paso era demasiado permisivo en la dirección contraria: autorizaba el endpoint S3 de
 * CUALQUIER cuenta de R2, no de la nuestra.
 *
 * ── POR QUÉ SE DERIVA Y NO SE ESCRIBE A MANO ────────────────────────────────────────────
 *
 * Porque el dominio bueno no se puede saber desde aquí: depende del despliegue, y con varias
 * instancias (una por nicho) hay uno por cada una. Escribir `*.r2.dev` sería acertar sólo si
 * nadie pone dominio propio; escribir el dominio propio sería acertar sólo en una instancia.
 *
 * Así que se deriva de `NEXT_PUBLIC_MEDIA_URL`, que es **el espejo en el frontend de
 * `S3_PUBLIC_URL` del backend** — la variable con la que la API construye las URLs públicas y
 * que **se persiste ENTERA en la base de datos** al subir (`ListingImage.url`,
 * `Listing.video*Url`, `SponsoredAd.imageUrl`, `HomepageConfig.blocks`…). Una sola fuente
 * para «de dónde salen los medios», declarada dos veces porque son dos procesos, no dos
 * criterios.
 *
 * ⚠ **DOS AVISOS DE DESPLIEGUE, los dos aprendidos y no supuestos:**
 *
 *  1. `NEXT_PUBLIC_*` se incrusta en el bundle **al construir**, no al arrancar. Si esta
 *     variable no está presente durante `next build`, el contenedor arrancará con la lista
 *     sin el dominio de producción y las imágenes fallarán aunque la variable exista en
 *     tiempo de ejecución.
 *  2. `S3_PUBLIC_URL` y ésta tienen que apuntar al MISMO sitio, y hay que fijarlas **antes de
 *     la primera subida**: cambiar el dominio después no reescribe lo ya guardado en la base.
 *     Es literalmente el episodio de `localhost:9000` → `127.0.0.1:9000` de `CLAUDE.md`,
 *     anticipado para producción.
 */

type Patron = { protocol: 'http' | 'https'; hostname: string };

/**
 * El host del que se sirven los medios, sacado de su URL.
 *
 * Devuelve una lista (vacía o de uno) en vez de `null` para poder expandirla sin más en la
 * lista de abajo. Si la variable falta o no es una URL, no se añade nada y quedan los
 * dominios de desarrollo: **degradar es correcto aquí**, porque una lista rota impediría
 * construir, y el modo de fallo que importa —el dominio ausente— ya lo cubre la barrera de
 * `image-domains.test.ts`.
 */
function patronDe(url: string | undefined): Patron[] {
  if (!url) return [];
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return [];
    return [{ protocol: protocol === 'https:' ? 'https' : 'http', hostname }];
  } catch {
    return [];
  }
}

export const remotePatterns: Patron[] = [
  // Desarrollo: MinIO. `localhost` Y `127.0.0.1` porque en Windows el reenvío IPv6 de Docker
  // Desktop obliga a usar la segunda —`/_next/image` hace fetch de SERVIDOR contra MinIO y
  // sufría el mismo ECONNRESET, devolviendo 500—. Ver CLAUDE.md.
  { protocol: 'http', hostname: 'localhost' },
  { protocol: 'http', hostname: '127.0.0.1' },
  // Producción: el dominio público real, sea `pub-….r2.dev` o uno propio.
  ...patronDe(process.env.NEXT_PUBLIC_MEDIA_URL),
];

/**
 * ¿Puedo pintar este medio?
 *
 * NO ES CEREMONIA, y por eso vive al lado de `remotePatterns` en vez de dentro de él: hay
 * superficies que **no pasan por `remotePatterns`** —un `background-image` de CSS, un
 * `<video src>`— y que sin esta comprobación convertirían cualquier URL guardada en la base
 * en una petición del navegador del visitante a un tercero. Las dos listas tienen que ser la
 * misma o la más floja gana; por eso es una sola.
 */
export function isSafeSrc(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return remotePatterns.some(({ protocol: p, hostname: h }) => {
      if (p + ':' !== protocol) return false;
      // "*.foo.com" wildcard: matches any single-label subdomain
      if (h.startsWith('*.')) return hostname.endsWith(h.slice(1));
      return hostname === h;
    });
  } catch {
    return false;
  }
}
