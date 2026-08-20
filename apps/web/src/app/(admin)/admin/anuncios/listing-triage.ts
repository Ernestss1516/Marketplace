/**
 * ETIQUETA INTERNA (P1) — RÁFAGA E2: cómo se PINTA el triaje.
 *
 * Espejo de `listing-status.ts`, y por el mismo motivo: la ficha, la lista y los
 * filtros necesitan exactamente las mismas etiquetas, y copiarlas crearía tres
 * verdades sobre cómo se llama un valor. En este proyecto ese defecto ya se ha
 * pagado una vez (`PAUSED` y `ARCHIVED` pintando el enum crudo hasta B2).
 *
 * ESPEJO api↔web. Los valores del enum viven en `schema.prisma` y las reglas en
 * `apps/api/src/modules/listings/listing-triage.ts`. Aquí sólo está la
 * PRESENTACIÓN — ninguna regla se reimplementa: qué se puede poner a mano lo
 * decide el backend, y esta lista es lo que la interfaz ofrece para no prometer
 * un botón que va a responder 400.
 */

/** El ciclo del triaje. Tres valores excluyentes. */
export type Triage = 'NEW' | 'REVIEWED' | 'EDITED';

export const TRIAGE_LABELS: Record<Triage, string> = {
  NEW: 'Nuevo',
  REVIEWED: 'Revisado',
  EDITED: 'Editado',
};

/**
 * La variante visual. `EDITED` es `destructive` a propósito: es la única de las
 * tres que PIDE algo al staff —«esto que diste por bueno ha cambiado, míralo»—,
 * y tiene que distinguirse de un vistazo en una lista de veinte filas.
 */
export const TRIAGE_VARIANTS: Record<Triage, 'default' | 'secondary' | 'outline' | 'destructive'> =
  {
    NEW: 'secondary',
    REVIEWED: 'outline',
    EDITED: 'destructive',
  };

/** Los tres, en el orden en que el moderador los piensa (lo pendiente primero). */
export const TRIAGE_VALUES: Triage[] = ['EDITED', 'NEW', 'REVIEWED'];

/**
 * LO QUE LA INTERFAZ OFRECE PONER A MANO — `EDITED` **no está**.
 *
 * No es una simplificación: `EDITED` afirma un HECHO («el dueño cambió esto
 * después de que lo revisaran») y sólo el sistema puede saber si ocurrió. El
 * backend lo rechaza con un 400 (`isManualTriageTarget`); esto es que la UI no
 * ofrezca un botón que va a fallar.
 *
 * `NEW` sí está, para poder DESHACER un «revisado» puesto por error.
 */
export const TRIAGE_MANUAL_VALUES: Triage[] = ['NEW', 'REVIEWED'];

export function etiquetaDeTriage(triage: string): string {
  return TRIAGE_LABELS[triage as Triage] ?? triage;
}

export function varianteDeTriage(
  triage: string,
): 'default' | 'secondary' | 'outline' | 'destructive' {
  return TRIAGE_VARIANTS[triage as Triage] ?? 'outline';
}
