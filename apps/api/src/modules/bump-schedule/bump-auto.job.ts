/**
 * El contrato del job del bump automático, en su propio fichero para que el scheduler (que
 * lo produce) y el processor (que lo consume) no tengan que importarse entre ellos.
 */

export const BUMP_AUTO_JOB = {
  RUN_TURN: 'run-turn',
} as const;

export interface RunTurnJobData {
  scheduleId: string;
  /** La fila de `BumpRun` ya reclamada por el scheduler; el processor la resuelve. */
  runId: string;
  /** El instante previsto del turno, en ISO. Informativo para el log y la traza. */
  slot: string;
}

/**
 * Identificador estable del job de un turno — el SEGUNDO guard de idempotencia.
 *
 * Mismo turno, mismo id: BullMQ no crea dos jobs para el mismo `(programación, turno)`. No
 * sustituye al reclamo en la base (ese es el que manda, porque sobrevive a que la cola se
 * vacíe), pero evita el trabajo duplicado antes de que llegue a intentarse.
 */
export function bumpAutoJobId(scheduleId: string, slot: Date): string {
  return `bump-auto-${scheduleId}-${slot.toISOString()}`;
}
