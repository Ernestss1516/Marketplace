import { ListingTriage } from '@prisma/client';

/**
 * ETIQUETA INTERNA (P1) — LAS REGLAS DEL TRIAJE, EN UN FICHERO PURO.
 *
 * FICHERO PURO, SIN DI, por el mismo motivo que `listing-status.transitions.ts`:
 * lo necesitan `ListingsService` (ListingsModule, para la transición automática)
 * y `AdminService` (AdminModule, para la manual), y AdminModule **no** importa
 * ListingsModule. Un servicio inyectable habría obligado a cablear un módulo
 * nuevo para tres constantes y dos funciones.
 *
 * LO QUE ESTE FICHERO NO SABE, Y NO DEBE SABER: nada de `ListingStatus`. El
 * triaje y el estado del anuncio son ejes independientes — un anuncio puede ser
 * ACTIVE y EDITED, o PENDING_REVIEW y NEW — y este fichero no importa el uno para
 * poder razonar sobre el otro. Si alguna vez hace falta importar `ListingStatus`
 * aquí, es la señal de que los dos ejes se están fundiendo.
 *
 * Ver docs/diseno-etiqueta-interna.md §1 y §2.
 */

/** Etiquetas en español, para la interfaz y los mensajes de error. */
export const LISTING_TRIAGE_LABELS: Readonly<Record<ListingTriage, string>> = {
  NEW: 'Nuevo',
  REVIEWED: 'Revisado',
  EDITED: 'Editado',
};

/**
 * LO QUE EL STAFF PUEDE PONER A MANO. `EDITED` **no está**, y no es un olvido.
 *
 * `EDITED` afirma que ocurrió un HECHO —«el dueño cambió esto después de que lo
 * revisaran»— y sólo el sistema puede saber si ocurrió. Los otros dos son juicios
 * («lo he mirado», «no lo he mirado»), y ésos sí son de quien modera.
 *
 * `NEW` sigue siendo alcanzable a mano para poder DESHACER: marcar «revisado» por
 * error se arregla desmarcándolo. Es la contrapartida de que este cuerpo entero
 * sea reversible, que es también por lo que es MODERATOR y no ADMIN.
 */
export const MANUAL_TRIAGE_TARGETS: readonly ListingTriage[] = ['NEW', 'REVIEWED'];

export function isManualTriageTarget(target: ListingTriage): boolean {
  return MANUAL_TRIAGE_TARGETS.includes(target);
}

/** El motivo, en español y diciendo qué SÍ se puede hacer. Molde: `describeIllegalTransition`. */
export function describeIllegalManualTriage(target: ListingTriage): string {
  const posibles = MANUAL_TRIAGE_TARGETS.map((t) => LISTING_TRIAGE_LABELS[t]).join(', ');
  return (
    `«${LISTING_TRIAGE_LABELS[target]}» no se puede poner a mano: lo marca el sistema ` +
    `cuando el dueño edita un anuncio ya revisado. A mano sólo: ${posibles}.`
  );
}

/**
 * LA ÚNICA TRANSICIÓN AUTOMÁTICA — el dueño acaba de editar su anuncio.
 *
 * REVIEWED → EDITED, **y nada más**. La guarda es la mitad de la regla:
 *
 *   · `NEW` se queda `NEW`. Nadie lo había mirado, así que editarlo no produce
 *     información nueva; marcarlo `EDITED` destruiría el dato que sí sirve
 *     («sigue sin revisar») para poner uno vacío.
 *   · `EDITED` se queda `EDITED`. Ya está señalado; volver a señalarlo no añade
 *     nada.
 *   · `REVIEWED` pasa a `EDITED`. Aquí sí: el juicio del staff acaba de caducar.
 *
 * POR QUÉ ESTO IMPORTA MÁS DE LO QUE PARECE: hoy la edición del dueño no cambia
 * `status`, no vuelve a pasar por el filtro de palabras y no consulta la
 * moderación previa —el filtro y el disparador sólo corren en `publish()`—, así
 * que **un anuncio ACTIVE se puede reescribir entero sin que se entere nadie**.
 * Ésta es la única señal que el staff va a recibir.
 *
 * Es una función y no un `if` suelto para poder probar las tres ramas sin montar
 * media aplicación, igual que `elegirAccionDeEstado` (M2).
 */
export function triageAfterOwnerEdit(current: ListingTriage): ListingTriage {
  return current === 'REVIEWED' ? 'EDITED' : current;
}
