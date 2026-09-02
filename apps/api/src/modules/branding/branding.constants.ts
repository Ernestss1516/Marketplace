/**
 * TRES LOGOS L1 — LO QUE SABEN DE LOS LOGOS QUIENES NO SE CONOCEN ENTRE SÍ.
 *
 * FICHERO PURO, SIN DI, y ésa es la razón entera de que exista separado del servicio:
 * lo importan `BrandingService` (que escribe los tres ajustes) y `MediaCleanupService`
 * (que tiene que saber cuáles son para NO borrar un logo vivo — ver §4.2 del diseño).
 * Los dos módulos no se ven entre sí, y si la lista de claves viviera dentro del
 * servicio habría que copiarla en la limpieza: el día que se añadiera una cuarta zona,
 * su logo quedaría desprotegido **en silencio**. Mismo movimiento, y por el mismo
 * motivo, que `media-keys.ts` con la clave de la miniatura y `listing-limits.ts` con
 * los topes.
 *
 * Ver `docs/diseno-logos.md` §2, §3 y §6.
 */
import { tipoDeFicheroNoAdmitido } from '../../common/mensajes-subida';

/** Las tres zonas de marca. El orden es el del documento: público, backoffice, blog. */
export const LOGO_ZONES = ['public', 'backoffice', 'blog'] as const;

export type LogoZone = (typeof LOGO_ZONES)[number];

/**
 * La clave de `Setting` de cada zona.
 *
 * **LAS TRES ESTÁN FUERA DEL WHITELIST DE `PATCH /admin/settings/:key`** (ver
 * `admin.service.ts`, `SETTING_KEYS`), y no por olvido: el PATCH genérico aceptaría
 * cualquier cadena —una URL de otro dominio en la cabecera de TODAS las páginas—, no
 * limpiaría el objeto anterior y no revalidaría nada. El único escritor de estas tres
 * claves es este módulo. Barrera: `PATCH /admin/settings/logoPublicUrl` → 400.
 */
export const LOGO_SETTING_KEYS: Readonly<Record<LogoZone, string>> = {
  public: 'logoPublicUrl',
  backoffice: 'logoBackofficeUrl',
  blog: 'logoBlogUrl',
};

/**
 * Las tres claves como lista, para quien necesita mirarlas sin saber nada de zonas.
 * Su único consumidor de fuera es la limpieza (`laReferenciaAlguienMas`), que pregunta
 * «¿esta URL es un logo activo?» y no «¿de qué zona?».
 */
export const LOGO_SETTING_KEY_LIST: readonly string[] = Object.values(LOGO_SETTING_KEYS);

/**
 * EL MAPA MIME **PROPIO**, Y NO EL COMPARTIDO DE `media.service.ts`.
 *
 * La diferencia es `image/svg+xml`, y por eso este mapa vive aquí en vez de ampliar
 * `MIME_TO_EXT`: aquel lo usan avatares, fotos de anuncio, bloques de blog, portada y
 * patrocinados —cinco superficies, cuatro alimentadas por usuarios o por EDITOR—, y un
 * SVG es un documento con scripts. Meterlo allí para cubrir la necesidad de una sola
 * superficie es abrir las otras cuatro de propina.
 *
 * POR QUÉ AQUÍ SÍ, con los tres hechos que lo sostienen:
 *
 *  · **sólo ADMIN sube** (el `@MinRole` de `AdminBrandingController`), no es contenido
 *    de usuario ni de editor;
 *  · **se sirve desde otro origen**: el bucket público es un dominio distinto del de la
 *    app, así que un `<script>` dentro del SVG no correría donde están las cookies de
 *    sesión;
 *  · **se pinta con `<img>`, nunca incrustado en el DOM** (decisión de L2), y ahí el
 *    script no se ejecuta jamás.
 *
 * Es el mismo reparto que hizo el vídeo con sus límites (`video-limits.ts:5`): las
 * constantes de una superficie viven con esa superficie cuando protegen otra cosa.
 */
export const LOGO_MIME_TO_EXT: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/jpeg': '.jpg',
};

export const LOGO_ALLOWED_MIME_TYPES: readonly string[] = Object.keys(LOGO_MIME_TO_EXT);

/**
 * Mensaje único de tipo no admitido: el `fileFilter` y el servicio dicen lo mismo.
 *
 * i18n T5 — sigue siendo suyo (los logos admiten SVG y las imágenes de contenido no), pero
 * la FRASE ya no se escribe aquí: sale del mismo constructor que las otras diez copias, así
 * que «formato no admitido» se redacta en un solo sitio y sólo cambia la lista. Ver
 * `common/mensajes-subida.ts`.
 */
export const LOGO_MIME_ERROR = tipoDeFicheroNoAdmitido('PNG, WebP, SVG o JPEG');

/**
 * 1 MB, y NO los 10 MB de `MAX_FILE_SIZE`.
 *
 * Ese número protege otra cosa: una foto de anuncio que se ve en una página. Un logo se
 * sirve en **todas**, así que un PNG de 10 MB no sería un fichero grande sino un
 * problema de rendimiento del sitio entero. Precedente literal: `video-limits.ts:5`.
 */
export const LOGO_MAX_BYTES = 1 * 1024 * 1024;

/**
 * Prefijo propio en el bucket, como `blocks/`, `homepage/` y `sponsored/`.
 *
 * El nombre del objeto es aleatorio y NO `logo-public.png`: una clave estable dejaría al
 * navegador sirviendo el logo viejo de su caché HTTP durante horas, y además haría
 * indistinguibles el objeto nuevo y el viejo justo donde la limpieza necesita
 * distinguirlos.
 */
export const LOGO_KEY_PREFIX = 'branding';

/**
 * Tag de caché en el frontend (`unstable_cache`). UNA entrada con clave constante
 * —`GET /branding` no filtra nada—, molde exacto de `footer-nav` y `homepage-config`.
 * Ver `apps/web/src/lib/api/branding.ts`.
 */
export const BRANDING_CACHE_TAG = 'branding';
