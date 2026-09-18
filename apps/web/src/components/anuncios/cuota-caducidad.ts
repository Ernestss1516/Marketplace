import type { ProStatus } from '@/lib/api/billing';

/**
 * «LA CUOTA DE ESTE MES SE VA A PERDER» — la regla, en un sitio y como función pura.
 *
 * ─── QUÉ CIERRA ──────────────────────────────────────────────────────────────────
 *
 * La cuota mensual Pro **no se acumula**: se cuenta contra `Subscription.currentPeriodStart`,
 * así que al avanzar el ciclo lo no gastado deja de contar y desaparece sin dejar rastro
 * (`EntitlementService.getFeaturedQuotaStatus` — el reseteo es derivado, no hay contador que
 * vaciar). Eso está bien resuelto por dentro y mal contado por fuera: hasta hoy **nada avisaba
 * al vendedor**, así que un Pro podía pagar su mes y perder cuatro destacados y cuatro bumps
 * sin enterarse. Era el único punto del producto donde alguien pierde algo que pagó sin que se
 * le diga.
 *
 * ─── POR QUÉ ES UNA FUNCIÓN PURA Y NO UN `if` EN EL COMPONENTE ───────────────────
 *
 * Porque la decisión tiene cinco condiciones encadenadas y **cuatro de ellas son formas de
 * NO avisar**. Un aviso que sale cuando no toca no es un aviso, es ruido; y el ruido se
 * arregla borrando la función, no ajustando un `&&` dentro de un JSX de 200 líneas. Con el
 * reloj inyectable, además, las cinco se prueban sin montar nada — que es el molde que ya usa
 * `resolveBumpCooldown` para exactamente el mismo problema (comparar un instante del backend
 * con el de ahora).
 *
 * ─── EL DATO NO SE RECALCULA ─────────────────────────────────────────────────────
 *
 * `remaining`, `bumpQuota.remaining` y `periodEnd` vienen ya resueltos de
 * `GET /billing/pro-status`. Aquí no se deriva ninguno: se leen y se decide si se enseñan. Si
 * esta función calculara el periodo por su cuenta —«un mes desde `periodStart`»— habría dos
 * verdades sobre cuándo caduca la cuota, y la del cliente sería la equivocada en cuanto una
 * renovación se adelantara o se retrasara un día.
 */

/**
 * CUÁNTOS DÍAS ANTES SE AVISA. **Tres, y el número es la decisión.**
 *
 * El aviso sólo sirve si queda tiempo de gastar la cuota: destacar es inmediato, pero los
 * bumps llevan una hora de enfriamiento entre uno y otro (`BUMP_COOLDOWN_SECONDS`), así que
 * gastar cuatro exige volver varias veces. Tres días dan para eso de sobra.
 *
 * Y POR ARRIBA LO QUE LO ACOTA ES EL RUIDO: una semana sería **un cuarto del ciclo** con un
 * aviso de urgencia encima de la lista de anuncios, y un aviso que está siempre deja de leerse
 * —exactamente el defecto que tenía el recordatorio de cuota antes de UXV.6, que se pintaba
 * igual tuviera o no algo que contar—. Lo que se gana avisando antes es poco; lo que se pierde
 * es que se lea el día que importa.
 */
export const DIAS_AVISO_CADUCIDAD = 3;

export interface AvisoCaducidad {
  /** Cuándo se renueva el ciclo — y por tanto cuándo se pierde lo que quede. */
  fecha: Date;
  /** Días naturales que faltan. 0 = hoy, 1 = mañana. */
  dias: number;
  /** Destacados gratis sin gastar. */
  destacados: number;
  /** Bumps gratis sin gastar. */
  bumps: number;
}

/** El día natural en que cae un instante, a las 00:00 locales. */
function inicioDelDia(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * ¿Hay que avisar de que la cuota se pierde? `null` = no, y es la respuesta mayoritaria.
 *
 * SE CUENTAN DÍAS NATURALES, NO MULTIPLOS DE 24 H, y no es un detalle: a las 23:00, «faltan
 * 49 horas» es pasado mañana para un reloj y **dentro de dos días** para la persona que lo
 * lee. La aritmética de milisegundos redondearía a 2,04 días y diría «faltan 2» el mismo rato
 * en que el usuario ya piensa en mañana.
 */
export function resolverAvisoCaducidad(
  proStatus: Pick<ProStatus, 'isPro' | 'remaining' | 'bumpQuota' | 'periodEnd' | 'quotaSource'>,
  ahora: Date = new Date(),
): AvisoCaducidad | null {
  // 1 — Sin plan, nada que perder.
  if (!proStatus.isPro) return null;

  /**
   * 2 — EL PRO MANUAL NO VE ESTE AVISO, y queda fuera por DOS puertas independientes.
   *
   * `quotaSource: 'NONE'` es la respuesta explícita del backend: es Pro, pero su cuota mensual
   * no cuelga de ningún ciclo porque nadie está pagando uno (decisión D-1). Y aunque ese campo
   * faltara —es opcional en este lado—, tampoco tiene `periodEnd`, así que la línea de abajo
   * lo pararía igual. Dos puertas para lo mismo porque **avisarle sería contarle que pierde
   * algo que nunca tuvo**, que es exactamente el defecto que UXV.6 arregló en el recordatorio
   * de al lado.
   */
  if (proStatus.quotaSource === 'NONE') return null;
  if (!proStatus.periodEnd) return null;

  const fecha = new Date(proStatus.periodEnd);
  if (Number.isNaN(fecha.getTime())) return null;

  /**
   * 3 — NADA QUE PERDER, NADA QUE DECIR. Si ya gastó las dos cuotas, el aviso sería una
   * urgencia sobre cero destacados y cero bumps. El recordatorio de al lado sigue diciendo que
   * las gastó, que es la información correcta en ese caso.
   */
  const destacados = proStatus.remaining;
  const bumps = proStatus.bumpQuota.remaining;
  if (destacados <= 0 && bumps <= 0) return null;

  // 4 — La ventana. `dias < 0` es un periodo ya vencido que el backend todavía no ha
  //     renovado: la cuota que se enseña es la del ciclo viejo y está a punto de refrescarse
  //     sola, así que meter prisa con una fecha pasada sólo confundiría.
  const dias = Math.round((inicioDelDia(fecha) - inicioDelDia(ahora)) / 86_400_000);
  if (dias < 0 || dias > DIAS_AVISO_CADUCIDAD) return null;

  return { fecha, dias, destacados, bumps };
}

/** «hoy», «mañana» o la fecha. Lo que una persona diría. */
export function cuandoCaduca(aviso: AvisoCaducidad): string {
  if (aviso.dias === 0) return 'hoy';
  if (aviso.dias === 1) return 'mañana';
  return `el ${new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(aviso.fecha)}`;
}

/**
 * Lo que queda, en palabras: «2 destacados y 1 bump», «3 bumps», «1 destacado».
 *
 * NOMBRA SÓLO LO QUE QUEDA. Decir «0 destacados y 3 bumps» pondría un cero delante de la
 * única cifra que importa, y el usuario tendría que leer dos veces para saber qué puede gastar.
 */
export function loQueSePierde(aviso: AvisoCaducidad): string {
  const partes: string[] = [];
  if (aviso.destacados > 0) {
    partes.push(`${aviso.destacados} destacado${aviso.destacados === 1 ? '' : 's'}`);
  }
  if (aviso.bumps > 0) {
    partes.push(`${aviso.bumps} bump${aviso.bumps === 1 ? '' : 's'}`);
  }
  return partes.join(' y ');
}
