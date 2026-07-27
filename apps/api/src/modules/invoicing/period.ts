/**
 * Utilidades de PERIODO para el cron de facturación automática (RF.13 R4). Puras
 * (sin BD, sin Date.now interno) → testeables en aislamiento. Un periodo se
 * identifica por una clave: "YYYY-Qn" (trimestral) o "YYYY-MM" (mensual).
 *
 * La periodicidad por defecto y confirmada por el asesor es TRIMESTRAL; MENSUAL
 * existe para que la selección por `Setting` sea real (configurable en caliente).
 */

export type Periodicity = 'QUARTERLY' | 'MONTHLY';

/** Trimestre (1-4) que contiene un mes 0-based (0=ene). */
function quarterOfMonth(month0: number): number {
  return Math.floor(month0 / 3) + 1;
}

/** Clave del periodo que CONTIENE la fecha dada. */
export function periodKeyContaining(date: Date, periodicity: Periodicity): string {
  const y = date.getFullYear();
  if (periodicity === 'MONTHLY') {
    return `${y}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${y}-Q${quarterOfMonth(date.getMonth())}`;
}

/**
 * Clave del periodo CERRADO más reciente respecto a `today` = el periodo
 * inmediatamente anterior al que contiene hoy. Ese es el que toca facturar.
 */
export function previousClosedPeriodKey(today: Date, periodicity: Periodicity): string {
  if (periodicity === 'MONTHLY') {
    const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  let q = quarterOfMonth(today.getMonth()) - 1;
  let y = today.getFullYear();
  if (q === 0) {
    q = 4;
    y -= 1;
  }
  return `${y}-Q${q}`;
}

/** Rango [start, end) de fechas de operación que caen en el periodo. */
export function periodRange(key: string): { start: Date; end: Date } {
  const qm = /^(\d{4})-Q([1-4])$/.exec(key);
  if (qm) {
    const y = Number(qm[1]);
    const startMonth = (Number(qm[2]) - 1) * 3;
    return { start: new Date(y, startMonth, 1), end: new Date(y, startMonth + 3, 1) };
  }
  const mm = /^(\d{4})-(\d{2})$/.exec(key);
  if (mm) {
    const y = Number(mm[1]);
    const m = Number(mm[2]) - 1;
    return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1) };
  }
  throw new Error(`Invalid periodKey: ${key}`);
}

/** Índice ordinal + tipo, para comparar/enumerar periodos. */
function periodIndex(key: string): { idx: number; kind: Periodicity } {
  const qm = /^(\d{4})-Q([1-4])$/.exec(key);
  if (qm) return { idx: Number(qm[1]) * 4 + (Number(qm[2]) - 1), kind: 'QUARTERLY' };
  const mm = /^(\d{4})-(\d{2})$/.exec(key);
  if (mm) return { idx: Number(mm[1]) * 12 + (Number(mm[2]) - 1), kind: 'MONTHLY' };
  throw new Error(`Invalid periodKey: ${key}`);
}

function keyFromIndex(idx: number, kind: Periodicity): string {
  if (kind === 'QUARTERLY') {
    return `${Math.floor(idx / 4)}-Q${(idx % 4) + 1}`;
  }
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/**
 * Periodos que hay que procesar: todos los CERRADOS y aún no facturados, entre
 * `afterKey` (exclusivo, la marca del último facturado) y `throughKey` (inclusivo,
 * el cerrado más reciente). Esto da RECUPERACIÓN: si el servidor estuvo caído en
 * uno o varios cierres, al arrancar detecta y emite todos los periodos pendientes.
 *
 * - `afterKey` null (primer arranque) → solo `[throughKey]` (no factura todo el
 *   histórico retroactivamente).
 * - periodicidad cambiada respecto a la marca → solo `[throughKey]` (evita
 *   enumerar entre formatos distintos; se retoma limpio desde el periodo actual).
 * - marca al día o por delante → `[]` (no toca).
 */
export function periodsToProcess(
  afterKey: string | null,
  throughKey: string,
  periodicity: Periodicity,
): string[] {
  const through = periodIndex(throughKey);
  if (through.kind !== periodicity) return [throughKey];
  if (!afterKey) return [throughKey];

  let after: { idx: number; kind: Periodicity };
  try {
    after = periodIndex(afterKey);
  } catch {
    return [throughKey];
  }
  if (after.kind !== periodicity) return [throughKey];
  if (after.idx >= through.idx) return [];

  const out: string[] = [];
  for (let i = after.idx + 1; i <= through.idx; i++) out.push(keyFromIndex(i, periodicity));
  return out;
}
