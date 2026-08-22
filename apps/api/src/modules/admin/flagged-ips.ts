/**
 * A1 — LAS IPs MARCADAS: la lista, y la coincidencia.
 *
 * FICHERO PURO, SIN DI, por el mismo motivo que `listing-triage.ts` y `phone-format.ts`: la
 * misma regla la aplican los anuncios y los usuarios, en cuatro sitios (dos listas y dos
 * fichas), y tenerla cuatro veces es como acaban divergiendo.
 *
 * ─── SÓLO AVISA. NADA BLOQUEA ────────────────────────────────────────────────────────
 *
 * Que la última IP de alguien esté marcada **no cambia el estado de nada**: el anuncio no va
 * a `PENDING_REVIEW` y el usuario no se marca `requiresReview`. Es una señal para el staff, y
 * hay dos razones independientes:
 *
 *   1. **La IP puede estar falsificada.** Mientras la topología del proxy no se verifique
 *      (`pendientes.md` §6, RC.1), este dato puede venir del cliente. Bloquear por algo que
 *      sabemos que puede mentir es exactamente lo que RC.1 pide no hacer.
 *   2. **El momento no encaja.** `Listing.lastOwnerIp` lo escribe el `touch` de 5a en CADA
 *      gestión del dueño —bump, pausa, renovación—, no sólo al tocar el contenido. Mandar un
 *      anuncio a revisión por hacer un bump sería castigar una acción que no tiene nada que
 *      ver, y además rompería el contrato del propio `touch` («anotar no puede tumbar la
 *      acción»).
 *
 * Y en el usuario no habría ni dónde: no existe `PENDING_REVIEW` para personas. `requiresReview`
 * sí existe, pero **lo pone una persona** y se audita con nombre; si el sistema lo escribiera,
 * un moderador que lo quitara se lo encontraría puesto otra vez en el siguiente login del
 * usuario — y `AuditLog.actorId` es NOT NULL con FK a `User`, así que no hay actor «sistema»
 * a quien apuntárselo. Es la lección de P1, otra vez. **La máquina señala; la persona marca.**
 *
 * ─── DERIVADO, NO PERSISTIDO — y la razón NO es el rendimiento ───────────────────────
 *
 * La detección de texto se persiste porque no se puede reescanear la tabla entera en cada
 * carga de una lista. Esto es otra cosa: `columna IN (lista)`, que Postgres resuelve directo.
 *
 * Lo que decide es la **RECTIFICABILIDAD**: quitar una IP de la lista **deja de marcar al
 * instante, en todo el histórico**. Con filas persistidas habría que barrerlas, y hasta
 * entonces el backoffice seguiría señalando gente por una regla que ya nadie mantiene. En una
 * lista de vigilancia eso no es un detalle de diseño: es la diferencia entre poder rectificar
 * un error y no poder.
 *
 * Coste aceptado: **no queda histórico** («esta IP estuvo marcada en marzo»). `AuditLog` sí
 * registra los cambios del ajuste, así que el quién y el cuándo de la LISTA están; lo que no
 * hay es una foto por usuario, y nadie la ha pedido.
 */

/** La clave del ajuste. Ver por qué no se llama «blocked» en `SETTING_KEYS`. */
export const FLAGGED_IPS_SETTING = 'flaggedIps';

/**
 * Normaliza el valor guardado a un conjunto de IPs, listo para comparar.
 *
 * VALIDA CLAVE A CLAVE Y DESCARTA LO QUE NO SIRVA, mismo criterio que
 * `parseDetectionModes`: el ajuste lo edita una persona y puede llegar cualquier cosa. Una
 * entrada en blanco es especialmente peligrosa — sin filtrarla, `''` acabaría en el conjunto
 * y **marcaría a todo el que no tiene IP anotada**, que son casi todos.
 */
export function parseFlaggedIps(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(
    raw
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

/**
 * ¿La última IP de esto está marcada?
 *
 * **IGUALDAD EXACTA**, nunca `contains`, y es la misma barrera que 5b dejó puesta para su
 * filtro: un `contains` sobre «10.0.0.1» casaría «110.0.0.10», y en una investigación de
 * multicuenta eso no es un falso positivo cualquiera — **es señalar a quien no es**.
 *
 * Sin IP anotada, no hay coincidencia posible. `null` no está marcado: está en blanco.
 */
export function ipMarcada(ip: string | null | undefined, marcadas: Set<string>): boolean {
  return !!ip && marcadas.has(ip);
}
