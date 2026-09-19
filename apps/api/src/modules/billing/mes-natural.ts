/**
 * LA VENTANA DE LA CUOTA MENSUAL DE PRO — el mes natural, y de dónde salen sus bordes.
 *
 * ─── QUÉ CIERRA ──────────────────────────────────────────────────────────────────
 *
 * La cuota mensual se contaba con un `COUNT` desde `Subscription.currentPeriodStart`, es
 * decir, **desde el ciclo de COBRO**. Para un Pro mensual eso coincide con «al mes» y
 * funcionaba; para un Pro **ANUAL** el ciclo dura un año, así que recibía su cuota «mensual»
 * **una vez al año — 1/12 de lo que la página de precios le promete** (4 destacados y 4 bumps
 * al año en vez de 48 y 48). Ver `docs/auditoria-y-diseno-cuotas-pro.md` §2.
 *
 * La ventana pasa a ser el **MES NATURAL DE CALENDARIO**: del día 1 a las 00:00 hasta el día
 * 1 del mes siguiente a las 00:00. Y con eso el anual y el mensual reciben exactamente lo
 * mismo cada mes, porque **ninguno de los dos se lo pregunta ya a su suscripción**.
 *
 * ─── POR QUÉ CALENDARIO Y NO «30 DÍAS DESDE EL ALTA» ─────────────────────────────
 *
 * Porque el calendario es el único que **no necesita un ancla por usuario** (§6.2 del
 * diseño). Una ventana rodante tiene que saber «desde cuándo», y ese dato vive en una fila
 * distinta según el tipo de Pro —`Subscription` para quien paga, `Entitlement` para un Pro
 * concedido a mano—, que es volver a tener una regla por tipo: exactamente lo que este
 * cambio existe para eliminar. Aquí no se pregunta nada: sólo el reloj.
 *
 * Su coste, dicho sin adornos: **el primer mes es parcial**. Quien se hace Pro el día 28
 * recibe la cuota entera para tres días y otra entera el día 1. Se acepta a propósito: el
 * coste está acotado a una cuota extra por usuario **una sola vez en su vida**, y prorratear
 * convertiría un regalo de bienvenida en una fracción que hay que explicar (§6.2, D-10).
 *
 * ─── POR QUÉ LA ZONA SE DECLARA Y NO SE HEREDA ───────────────────────────────────
 *
 * `new Date(y, m, 1)` usa la zona del PROCESO, y este proyecto ya avisa de que esa zona no
 * está garantizada (`instance-info.types.ts`: «un servidor en UTC…»). Con el servidor en UTC
 * y España en horario de verano, el mes cambiaría a las **02:00 peninsulares**: quien gastara
 * su última cuota a la 01:00 del día 1 la vería contar contra el mes anterior. El borde de la
 * ventana decide cuánto valor recibe un cliente que paga, así que no puede depender de cómo
 * esté configurado el contenedor.
 *
 * Mismo patrón —y mismo motivo— que `bump-schedule/next-run.ts` con `hourOfDay`: la zona se
 * declara en una constante y el desplazamiento se le pregunta a `Intl` en la fecha concreta,
 * no a una tabla propia de cambios de hora que se quedaría vieja.
 *
 * ─── PURA, SIN NEST Y SIN RELOJ INTERNO ──────────────────────────────────────────
 *
 * Las dos funciones reciben el instante. Es lo que permite probar el 1 de enero, el 29 de
 * febrero, el 31 de marzo y los dos cambios de hora sin montar la aplicación ni esperar al
 * calendario — y es la misma decisión, por la misma razón, que ya tomaron `next-run.ts` y
 * `cuota-caducidad.ts`. Aquí importa más que en ninguno de los dos: de esta aritmética
 * depende cuánta cuota recibe cada cliente de pago.
 */

/** La zona en la que se interpreta «el día 1 a las 00:00». Declarada, no heredada del proceso. */
export const QUOTA_TIMEZONE = 'Europe/Madrid';

/**
 * Desplazamiento de `QUOTA_TIMEZONE` respecto a UTC, en minutos, en un instante dado.
 *
 * España cambia de hora dos veces al año (+1 en invierno, +2 en verano), así que el offset
 * NO es fijo: hay que preguntárselo al calendario en la fecha concreta. Copiado del patrón ya
 * probado en producción por `next-run.ts` (`tzOffsetMinutes`), no reinventado.
 */
function tzOffsetMinutes(instant: Date): number {
  const enZona = new Date(instant.toLocaleString('en-US', { timeZone: QUOTA_TIMEZONE }));
  const enUtc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((enZona.getTime() - enUtc.getTime()) / 60_000);
}

/**
 * El instante UTC del día 1 a las 00:00 (hora peninsular) del mes que contiene `referencia`,
 * desplazado `meses` meses.
 *
 * SE CALCULA EN DOS PASADAS porque el propio cambio de hora puede caer ENTRE la referencia y
 * el borde del mes, y entonces el offset de una no sirve para la otra. Ejemplo real: el 30 de
 * marzo (ya en CEST, +2) preguntando por el inicio de SU mes, que es el 1 de marzo (todavía
 * en CET, +1) — sin la corrección, el borde quedaría una hora movido y el día 1 empezaría a
 * las 23:00 del 28 de febrero. Se estima con el offset de la referencia y se corrige con el
 * offset del instante ya estimado.
 *
 * `Date.UTC` absorbe el desbordamiento de mes (mes 12 → enero del año siguiente), así que el
 * salto de diciembre a enero no necesita ningún caso aparte.
 */
function inicioDeMesEnZona(referencia: Date, meses: number): Date {
  const offset = tzOffsetMinutes(referencia);
  const local = new Date(referencia.getTime() + offset * 60_000);

  const estimado =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + meses, 1, 0, 0, 0, 0) -
    offset * 60_000;

  const offsetReal = tzOffsetMinutes(new Date(estimado));
  if (offsetReal === offset) return new Date(estimado);
  return new Date(estimado + (offset - offsetReal) * 60_000);
}

/**
 * El primer instante del mes natural que contiene `ahora` — el borde INCLUSIVO desde el que
 * se cuenta lo gastado (`createdAt >= inicioDelMesNatural()`).
 */
export function inicioDelMesNatural(ahora: Date = new Date()): Date {
  return inicioDeMesEnZona(ahora, 0);
}

/**
 * El primer instante del mes SIGUIENTE — es decir, el borde **EXCLUSIVO** de la ventana: el
 * instante en que la cuota no gastada se pierde y empieza una nueva.
 *
 * ES EXCLUSIVO A PROPÓSITO, y es el mismo criterio que tenía el campo al que sustituye:
 * `Subscription.currentPeriodEnd` era el instante de la RENOVACIÓN, no el último segundo del
 * ciclo. Quien lo lee lo trata como una fecha de corte —«se renueva el 1 de octubre»— y ése
 * sigue siendo el significado. Devolver «el 30 a las 23:59:59.999» obligaría a los dos
 * lectores del frontend a redondear, y el aviso de caducidad diría «el 30» de una cuota que
 * todavía se puede gastar ese día entero.
 */
export function finDelMesNatural(ahora: Date = new Date()): Date {
  return inicioDeMesEnZona(ahora, 1);
}
