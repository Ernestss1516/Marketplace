/**
 * EL PLAZO DE CADUCIDAD DE UN ANUNCIO — la clave, el defecto y su lectura tolerante.
 *
 * FICHERO PURO Y APARTE DEL SERVICIO, molde exacto de `listing-gate/photo-limits.ts` y
 * `listing-gate/listing-limits.ts`: la clave la escribe quien la configura desde el backoffice
 * y la lee quien publica un anuncio, que son sitios distintos. Puro además para que se pueda
 * probar el parseo sin levantar Nest.
 *
 * ── QUÉ DEFECTO CIERRA ────────────────────────────────────────────────────────────────────
 *
 * `listingExpiryDays` llevaba desde el MVP sembrado, editable en `/admin/ajustes` y con una
 * descripción que prometía «días desde la publicación hasta que un anuncio caduca». **Y no lo
 * leía nadie**: el plazo real era la constante `EXPIRY_DAYS = 60` de `expiration.service.ts`.
 * Un administrador podía ponerlo en 30, ver «Guardado», y los anuncios seguían caducando a los
 * 60. Era uno de los DOS AJUSTES MUERTOS que este repo se citaba a sí mismo como escarmiento
 * en tres comentarios distintos (`category.types.ts`, `listing-gate.types.ts`,
 * `attribute-revalidation.rule.ts`). Ver docs/auditoria-ajustes-backoffice.md §3.
 *
 * ── POR QUÉ NO ES RETROACTIVO, Y ES LA DECISIÓN ───────────────────────────────────────────
 *
 * `Listing.expiresAt` es una FECHA CONGELADA en la fila: se calcula al publicar (y al renovar,
 * reactivar, aprobar…) y se guarda. El cron de las 02:00 no recalcula nada, sólo compara
 * `expiresAt <= now`. Así que cambiar este ajuste **afecta únicamente a lo que se publique
 * después**; los anuncios vivos conservan el vencimiento con el que nacieron.
 *
 * Es lo correcto y no una limitación: recalcular en caliente movería la fecha de caducidad de
 * anuncios ajenos ya publicados —hacia atrás, incluso caducándolos de golpe al bajar el
 * número—, y además dejaría inservible la marca `expiryWarnedFor`, que es literalmente «el
 * vencimiento contra el que ya avisé». La descripción del backoffice lo dice con estas
 * palabras para que nadie lo descubra por el efecto.
 */

/** El plazo de siempre. Sin fila (o con una basura dentro), manda este 60. */
export const DEFAULT_EXPIRY_DAYS = 60;

/** La clave del ajuste. Debe coincidir con `SETTING_KEYS` en `admin.service.ts`. */
export const LISTING_EXPIRY_SETTING = 'listingExpiryDays';

/**
 * De un `Setting.value` que viene de fuera al número de días que de verdad se aplica.
 *
 * TOLERANTE CON LA CONFIGURACIÓN ROTA, igual que `PhotoLimitsService.leerNumero` y
 * `TagsService.getMaxTagsPerListing`: un `null`, un `"sesenta"`, un `0` o un negativo caen al
 * defecto en vez de tumbar la publicación de todo el mundo. **Un ajuste mal escrito no puede
 * ser un incidente** — el sitio donde se rechaza un valor inválido es el PATCH del backoffice
 * (con su 400), no el camino caliente de publicar.
 *
 * Se exige entero: medio día de caducidad no significa nada y `Math.trunc` silencioso sería
 * peor que caer al defecto, porque un 30.5 guardado a mano se aplicaría como 30 sin que la
 * pantalla lo dijera.
 */
export function parseExpiryDays(value: unknown): number {
  const dias = Number(value);
  if (!Number.isInteger(dias) || dias < 1) return DEFAULT_EXPIRY_DAYS;
  return dias;
}
