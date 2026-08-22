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

/** Qué detector encontró algo. Ráfaga A añade `IP` y `PHONE`. */
export type DetectorId = 'WORD';

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

/** En qué campo se encontró. Hoy los dos que `BadWordService` ya miraba, ni uno más. */
export type DetectionField = 'TITLE' | 'DESCRIPTION';

/** El texto de un anuncio que se somete a los detectores. */
export interface DetectableText {
  title: string;
  description: string;
}

/** Un hallazgo. Todavía no se persiste — la tabla `ListingDetection` es la ráfaga A. */
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
 */
export const DEFAULT_DETECTION_MODES: Readonly<Record<DetectorId, DetectionMode>> = {
  WORD: 'BLOCK',
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
