/**
 * PUNTO 6 · RÁFAGA 0 — LA FORMA DEL MOTOR DE DETECCIÓN, en un fichero puro.
 *
 * FICHERO PURO, SIN DI, por el mismo motivo que `listing-triage.ts` y
 * `listing-status.transitions.ts`: lo necesitan el motor (ModerationModule), sus detectores
 * y los consumidores (ListingsModule, AdminModule), y no todos esos módulos se importan
 * entre sí. Un inyectable para tres tipos y una constante habría obligado a cablear.
 *
 * ─── QUÉ HACE ESTA RÁFAGA, Y QUÉ NO ──────────────────────────────────────────────────
 *
 * La ráfaga 0 **no añade una sola funcionalidad**. Extrae `BadWordService` a un motor con
 * la forma que admitirá varios detectores y dos modos, y **deja la conducta byte-idéntica**:
 * las mismas palabras casan, las mismas no casan, `publish()` bloquea igual.
 *
 * Lo que YA está aquí y hoy tiene un solo valor útil:
 *
 *   · `DetectorId` — hoy sólo `WORD`. `IP` y `PHONE` son la ráfaga A.
 *   · `DetectionMode` — hoy `WORD` es `BLOCK`, que es lo que hace desde siempre. El modo
 *     `WARN` existe como concepto y el motor ya ramifica por él, pero **ningún detector lo
 *     usa todavía**: encenderlo es la ráfaga A.
 *
 * Lo que NO está, a propósito: leer los modos de `Setting['detectionModes']`. Eso es una
 * lectura de base de datos NUEVA, y una lectura nueva no es conducta byte-idéntica. En la
 * ráfaga 0 los modos son la constante de abajo; hacerlos configurables es la ráfaga B.
 *
 * Ver `docs/diseno-listas-bloqueo.md` §2 y §5.1.
 */

/**
 * Qué detector encontró algo.
 *
 * RÁFAGA A — pasa de ser una unión escrita a mano a ser **el enum de Prisma**. No es
 * cosmético: desde que las detecciones se persisten, la base de datos es quien manda sobre
 * los valores posibles, y tener aquí una segunda lista que se pudiera desincronizar de la
 * columna es exactamente la divergencia silenciosa que este proyecto ya ha pagado.
 */
import type { DetectorId, DetectionField } from '@prisma/client';

export type { DetectorId, DetectionField };

/**
 * Qué le pasa al anuncio cuando este detector encuentra algo.
 *
 *   · `BLOCK` — deja la detección Y manda a revisión. Es lo que `WORD` hace hoy.
 *   · `WARN`  — deja la detección y no toca el estado. Nadie lo usa todavía (ráfaga A).
 *
 * `BLOCK` es `WARN` **más una consecuencia**: los dos dejan exactamente el mismo rastro.
 * Por eso ascender un detector no cambiará lo que el staff ve, sólo lo que le pasa al
 * anuncio — y degradarlo de vuelta no perderá nada.
 */
export type DetectionMode = 'WARN' | 'BLOCK';

/**
 * En qué campo se encontró. Los mismos dos que `BadWordService` ya miraba, ni uno más:
 * ampliar los campos escaneados es una decisión de producto, no del motor.
 *
 * También el enum de Prisma, por el mismo motivo que `DetectorId` (re-exportado arriba).
 */

/** El texto de un anuncio que se somete a los detectores. */
export interface DetectableText {
  title: string;
  description: string;
}

/** Un hallazgo. La ráfaga A lo persiste en `ListingDetection`, reemplazado entero. */
export interface Detection {
  detector: DetectorId;
  field: DetectionField;
  /** El fragmento encontrado. Para `WORD`, el token normalizado que casó. */
  match: string;
  /** Qué regla casó: la entrada de la lista para `WORD`; `null` en los detectores de patrón. */
  rule: string | null;
}

/**
 * Un detector es una función sobre texto que devuelve hallazgos.
 *
 * LO QUE UN DETECTOR NO SABE, y es lo que hace que esto sea un motor y no tres `if`
 * sueltos: **no sabe qué pasa después**. No conoce `ListingStatus`, no decide bloquear y no
 * lee su propio modo. Devuelve lo que encuentra; el modo lo aplica el motor.
 *
 * Es lo que permitirá que ascender un patrón de avisar a bloquear sea cambiar un valor y no
 * reescribir un detector. Si algún día un detector necesita importar `ListingStatus`, es la
 * señal de que las dos capas se están fundiendo — el mismo aviso que `listing-triage.ts` se
 * dejó a sí mismo.
 */
export interface Detector {
  readonly id: DetectorId;
  scan(text: DetectableText): Promise<Detection[]>;
}

/**
 * EL MODO DE CADA DETECTOR — hoy una constante, mañana un `Setting`.
 *
 * `WORD: 'BLOCK'` NO es una decisión nueva: es literalmente lo que el filtro de palabras
 * hace desde que existe (`publish()` lo manda a `PENDING_REVIEW`). Escribirlo aquí como
 * `WARN` habría apagado en silencio un filtro que alguien configuró — el error contrario al
 * que esta ráfaga viene a evitar.
 *
 * `IP` E `PHONE` NACEN EN `WARN`, y ésa es la decisión entera de la ráfaga A. No es
 * prudencia genérica: los dos tienen falsos positivos REALES y nombrados —quien vende un
 * router y escribe «configuración en 192.168.1.1» tiene un anuncio impecable; cualquier
 * referencia de nueve dígitos que empiece por 6-9 parece un teléfono— y **no hay ni un dato**
 * sobre con qué frecuencia se equivocan. Un detector que se equivoca en las dos direcciones
 * no puede nacer sacando anuncios del escaparate.
 *
 * Que el `Record` sea sobre `DetectorId` (el enum de Prisma) obliga a declarar el modo de
 * cada detector nuevo: no se puede añadir uno y olvidarse de decidir qué hace.
 */
export const DEFAULT_DETECTION_MODES: Readonly<Record<DetectorId, DetectionMode>> = {
  WORD: 'BLOCK',
  IP: 'WARN',
  PHONE: 'WARN',
};

/** El resultado de una pasada del motor sobre un texto. */
export interface DetectionRunResult {
  /** Todo lo encontrado, de todos los detectores. */
  detections: Detection[];
  /**
   * `true` si ALGUNA detección viene de un detector en modo `BLOCK`.
   *
   * Es lo que sustituye al booleano de `hasBadWords`, y en la ráfaga 0 vale exactamente lo
   * mismo que él: con un único detector, y en `BLOCK`, «hay bloqueo» ⟺ «casó una palabra».
   */
  blocking: boolean;
}
