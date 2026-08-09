/**
 * Cuándo toca el siguiente turno de una programación.
 *
 * FUENTE ÚNICA del cálculo, y función PURA a propósito: es la pieza de la que depende que
 * la programación no derive, y se prueba sola —sin base de datos, sin cron y sin esperar al
 * reloj— exactamente como `period.ts` hace con los periodos de facturación.
 */

/** Zona en la que se interpreta `hourOfDay` (D4). Declarada, no heredada del proceso. */
export const BUMP_SCHEDULE_TIMEZONE = 'Europe/Madrid';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Desplazamiento de `Europe/Madrid` respecto a UTC, en minutos, en un instante dado.
 *
 * España cambia de hora dos veces al año (+1 en invierno, +2 en verano), así que «las 9:00»
 * NO es un offset fijo: hay que preguntárselo al calendario en la fecha concreta. Se resuelve
 * con `Intl` en vez de con una tabla propia de cambios de hora — la tabla se queda vieja, la
 * base de datos de zonas horarias de Node no.
 */
function tzOffsetMinutes(instant: Date): number {
  const enZona = new Date(
    instant.toLocaleString('en-US', { timeZone: BUMP_SCHEDULE_TIMEZONE }),
  );
  const enUtc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((enZona.getTime() - enUtc.getTime()) / 60_000);
}

/**
 * El instante UTC que corresponde a `hourOfDay` en hora peninsular, el día (peninsular) del
 * `reference` dado.
 *
 * Se calcula en dos pasadas porque el propio salto horario puede cambiar el offset entre la
 * estimación y el resultado: se estima con el offset del día de referencia y se corrige con
 * el offset del instante ya estimado. Sin la corrección, un turno programado a las 9:00 el
 * día del cambio de hora caería a las 8:00 o a las 10:00.
 */
function atHourInZone(reference: Date, hourOfDay: number): Date {
  const offset = tzOffsetMinutes(reference);
  const local = new Date(reference.getTime() + offset * 60_000);

  const estimado = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    hourOfDay,
    0,
    0,
    0,
  ) - offset * 60_000;

  const offsetReal = tzOffsetMinutes(new Date(estimado));
  if (offsetReal === offset) return new Date(estimado);
  return new Date(estimado + (offset - offsetReal) * 60_000);
}

/**
 * El turno siguiente al `slot` dado.
 *
 * ANCLADO AL TURNO PREVISTO, NUNCA A `now`. Es la propiedad anti-deriva: si una pasada se
 * retrasa veinte minutos, el turno siguiente no se corre veinte minutos, y «cada 3 días a
 * las 9:00» sigue siendo a las 9:00 el año que viene. Además hace el cálculo DETERMINISTA:
 * dos instancias que procesan el mismo turno obtienen el mismo resultado, que es lo que
 * permite compararlo y reclamarlo.
 *
 * NO SE ACUMULAN TURNOS ATRASADOS: si el servidor estuvo caído cuatro días, el resultado no
 * son cuatro bumps encadenados sino el primer turno FUTURO. Encadenar cobros retroactivos
 * sería lo contrario de lo que el usuario espera —y chocaría con el cooldown de todos modos.
 * Por eso el cálculo avanza en saltos de `intervalDays` hasta pasar de `now`.
 */
export function computeNextRunAt(
  slot: Date,
  intervalDays: number,
  hourOfDay: number,
  now: Date,
): Date {
  let candidato = atHourInZone(new Date(slot.getTime() + intervalDays * DAY_MS), hourOfDay);

  // Al día siguiente del salto, `atHourInZone` puede devolver un instante que aún no supere
  // `now`; se sigue avanzando en pasos del intervalo, nunca en pasos arbitrarios, para que
  // el resultado siga cayendo en la rejilla de la programación.
  while (candidato.getTime() <= now.getTime()) {
    candidato = atHourInZone(new Date(candidato.getTime() + intervalDays * DAY_MS), hourOfDay);
  }
  return candidato;
}

/**
 * El PRIMER turno de una programación recién creada o reanudada: el próximo `hourOfDay` que
 * todavía no ha pasado. Si hoy a esa hora ya pasó, mañana.
 *
 * Vive aquí y no en el servicio de negocio (que llega con la UI) para que el primer turno y
 * los siguientes se calculen con las MISMAS reglas de zona horaria. Que el primero se
 * calculara aparte es justo como se cuelan los desfases de una hora.
 */
export function computeFirstRunAt(now: Date, hourOfDay: number): Date {
  const hoy = atHourInZone(now, hourOfDay);
  if (hoy.getTime() > now.getTime()) return hoy;
  return atHourInZone(new Date(now.getTime() + DAY_MS), hourOfDay);
}
