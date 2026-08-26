/**
 * BORRADO DE CUENTAS C5 — el contrato de la cola de limpieza, EN SU PROPIO
 * FICHERO.
 *
 * NO ESTÁ EN `account-cleanup.processor.ts`, y la razón es un fallo que costó una
 * corrida: el procesador importa `AdminService` (es quien tiene `deleteListing`) y
 * `AdminService` necesita el nombre del trabajo para encolarlo. Con las
 * constantes dentro del procesador eso es un **ciclo de módulos de ES**, y Nest
 * revienta al arrancar con «can't resolve dependencies of the
 * AccountCleanupProcessor (?)» — porque cuando se lee la metadata del decorador,
 * uno de los dos módulos todavía es `undefined`.
 *
 * Un fichero de tipos sin dependencias rompe el ciclo: los dos lo importan y
 * ninguno se importa al otro.
 */
export const ACCOUNT_CLEANUP_JOB = {
  /** Borra UN anuncio de una cuenta que se acaba de vaciar. */
  DELETE_LISTING: 'delete-listing',
} as const;

export interface DeleteListingJobData {
  listingId: string;
  /**
   * Quién queda como actor del `AuditLog` del anuncio. Es el propio sujeto: el
   * ADMIN que eliminó la cuenta ya tiene su `USER_DELETE`, y atribuirle además
   * doscientos borrados de anuncio ensuciaría su historial con trabajo que no
   * decidió uno a uno.
   */
  actorId: string;
}
