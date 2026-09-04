/**
 * E7 — EL ESPEJO DEL REGISTRO DE ILUSTRACIONES.
 *
 * ── POR QUÉ HAY UNA COPIA, Y POR QUÉ NO SE PUEDE SEPARAR ────────────────────────────
 *
 * El registro vive en el backend (`apps/api/src/modules/ilustraciones/
 * ilustraciones.constants.ts`) porque es quien valida las subidas y quien resuelve qué
 * URL sirve cada slot. Pero **quien PINTA es este lado**, y los dos no se conocen: si la
 * lista viviera sólo allí, aquí no habría tipo con el que escribir `slot="empty-search"` y
 * un slot mal escrito no daría error hasta que alguien mirara la pantalla.
 *
 * Este monorepo no tiene paquete compartido, así que la solución es la que ya usa el
 * sistema de estilo para sus tokens: **una copia y un test que impide que se separen**.
 * `ilustraciones-espejo.spec.ts`, en el backend, LEE ESTE FICHERO y compara la lista con
 * la suya. Añadir un slot en un solo lado pone el CI en rojo señalando cuál falta — que es
 * exactamente el fallo silencioso que el §8.2 quería evitar.
 *
 * ── AQUÍ SÓLO ESTÁN LOS IDENTIFICADORES ────────────────────────────────────────────
 *
 * Ni el `alt`, ni la proporción, ni el default: eso lo resuelve el backend y llega
 * RESUELTO en `GET /ilustraciones`. Duplicar aquí el texto alternativo sería duplicar la
 * decisión de accesibilidad en dos sitios, y entonces la copia divergente sería la que
 * lee un lector de pantalla.
 */

/** Los diez slots de v1. Espejo de `ILUSTRACION_SLOTS` del backend, en el mismo orden. */
export const ILUSTRACION_IDS = [
  'empty-favorites',
  'empty-my-listings',
  'empty-search',
  'empty-messages',
  'empty-tickets',
  'empty-notifications',
  'success-payment',
  'success-review',
  'success-listing-published',
  'success-ticket-sent',
] as const;

export type IlustracionSlotId = (typeof ILUSTRACION_IDS)[number];

/** Lo que el backend devuelve por slot, ya resuelto: nunca hay que decidir nada aquí. */
export interface IlustracionResuelta {
  url: string;
  alt: string;
  ancho: number;
  alto: number;
  esDefecto: boolean;
}

export type IlustracionesResueltas = Record<IlustracionSlotId, IlustracionResuelta>;
