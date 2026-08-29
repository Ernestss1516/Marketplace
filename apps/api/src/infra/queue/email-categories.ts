import { NOTIFICATION_JOB } from './notification.types';
import type { SendListingLifecycleData } from './notification.types';

/**
 * NOTIFICACIONES N5 — LA FRONTERA: qué correos se pueden silenciar y cuáles NO.
 *
 * ── LA REGLA, Y ES LA RAZÓN DE QUE ESTE FICHERO EXISTA ──────────────────────
 *
 * **Las CRÍTICAS ni preguntan.** No es que se consulte la preferencia y se ignore:
 * es que su camino de envío **no llega a consultarla**. `categoriaDe()` devuelve
 * `null` para ellas, y el `null` corta antes de que exista la menor posibilidad de
 * mirar una bandera.
 *
 * La diferencia importa porque un fallo en la consulta —una columna mal leída, un
 * usuario que no se encuentra, una excepción tragada— sólo puede afectar a lo que
 * pasa por ahí. Si una sanción pasara por la comprobación «pero ignorando el
 * resultado», ese fallo podría silenciarla. Así no puede.
 *
 * ── QUÉ ES CRÍTICO ─────────────────────────────────────────────────────────
 *
 * Lo que decide sobre su CUENTA, su DINERO o su CONTENIDO sin que él lo pidiera, y
 * lo que le da acceso. No es una escala de importancia: es «¿puede esta persona
 * elegir no enterarse de esto?». De un baneo, no.
 *
 * ── EL `Record` ES EXHAUSTIVO A PROPÓSITO ──────────────────────────────────
 *
 * Un correo nuevo **no compila** hasta que alguien decida si se puede silenciar.
 * Es la red de A1 aplicada a la decisión que más caro sale olvidar: por omisión, un
 * tipo sin clasificar sería silenciable, y ése es justo el lado peligroso.
 */

/** Las categorías que el usuario puede apagar. Cada una, una columna en `User`. */
export type EmailCategory = 'MESSAGES' | 'LISTINGS' | 'REVIEWS' | 'ALERTS';

/** La columna de `User` que guarda cada categoría. */
export const COLUMNA_POR_CATEGORIA = {
  MESSAGES: 'emailMessages',
  LISTINGS: 'emailListings',
  REVIEWS: 'emailReviews',
  ALERTS: 'emailAlerts',
} as const satisfies Record<EmailCategory, string>;

type NombreDeJob = (typeof NOTIFICATION_JOB)[keyof typeof NOTIFICATION_JOB];

/**
 * `null` = CRÍTICA: no se puede silenciar y no se consulta nada.
 * Una función = la criticidad depende del contenido (hoy sólo el ciclo de vida del
 * anuncio, que mezcla «ha caducado» con «el staff te lo ha borrado»).
 */
type Clasificacion =
  | EmailCategory
  | null
  | ((data: Record<string, unknown>) => EmailCategory | null);

const CLASIFICACION: Record<NombreDeJob, Clasificacion> = {
  // ── CRÍTICAS: acceso a la cuenta ──────────────────────────────────────────
  // Sin esto no se puede entrar ni recuperar la contraseña. Silenciarlo sería
  // dejar a alguien fuera de su propia cuenta.
  [NOTIFICATION_JOB.SEND_VERIFICATION_EMAIL]: null,
  [NOTIFICATION_JOB.SEND_RESET_EMAIL]: null,

  // ── CRÍTICAS: decisiones sobre la cuenta ─────────────────────────────────
  // Suspensión, baneo, reinstauración, archivado, cambio de rol, eliminación. Y
  // recuérdese que un sancionado NO PUEDE ENTRAR a leer su campana: este correo es
  // literalmente el único canal que le queda (N2).
  [NOTIFICATION_JOB.SEND_ACCOUNT_MODERATED]: null,

  // ── CRÍTICAS: decisiones sobre su contenido ──────────────────────────────
  // Aprobado, rechazado, retirado o restaurado por el staff. No lo pidió él.
  [NOTIFICATION_JOB.SEND_LISTING_MODERATED]: null,

  // ── CRÍTICAS: dinero ──────────────────────────────────────────────────────
  // Le quitan saldo, se le paró lo que había contratado, o pierde la ventana de
  // facturación. Nadie elige no enterarse de esto.
  [NOTIFICATION_JOB.SEND_BALANCE_DEBITED]: null,
  [NOTIFICATION_JOB.SEND_BUMP_AUTO_PAUSED]: null,
  [NOTIFICATION_JOB.SEND_INVOICING_PENDING]: null,

  // ── CRÍTICA: caduca ───────────────────────────────────────────────────────
  // El ZIP se borra pasado el plazo. Un aviso silenciado aquí es un derecho que se
  // pierde por no enterarse.
  [NOTIFICATION_JOB.SEND_DATA_EXPORT_READY]: null,

  // ── CRÍTICAS: soporte y staff ─────────────────────────────────────────────
  // Conversaciones que el propio usuario abrió, o correo interno del equipo. El de
  // contacto ni siquiera va a un usuario registrado.
  [NOTIFICATION_JOB.SEND_TICKET_MESSAGE]: null,
  [NOTIFICATION_JOB.SEND_TICKET_RESOLVED]: null,
  [NOTIFICATION_JOB.SEND_TICKET_STAFF_NOTIFICATION]: null,
  [NOTIFICATION_JOB.SEND_CONTACT_NOTIFICATION]: null,
  [NOTIFICATION_JOB.SEND_CONTACT_REPLY]: null,

  // ── INFORMATIVAS: se pueden apagar ────────────────────────────────────────
  [NOTIFICATION_JOB.SEND_MESSAGE_UNREAD]: 'MESSAGES',
  [NOTIFICATION_JOB.SEND_ALERT_EMAIL]: 'ALERTS',
  [NOTIFICATION_JOB.SEND_REVIEW_RECEIVED]: 'REVIEWS',
  [NOTIFICATION_JOB.SEND_REVIEW_REQUEST_EMAIL]: 'REVIEWS',

  /**
   * EL ÚNICO MIXTO, y por eso la clasificación puede ser una función.
   *
   * `EXPIRING_SOON` y `EXPIRED` son informativos: el anuncio caduca solo, con aviso
   * previo, y quien no quiera el recordatorio puede apagarlo.
   *
   * `EDITED_BY_STAFF` y `DELETED_BY_STAFF` NO: son decisiones del equipo sobre su
   * contenido, una de ellas irreversible. Meter los cuatro en una categoría habría
   * hecho silenciable «hemos eliminado tu anuncio».
   */
  [NOTIFICATION_JOB.SEND_LISTING_LIFECYCLE]: (data) => {
    const { action } = data as unknown as SendListingLifecycleData;
    return action === 'EXPIRING_SOON' || action === 'EXPIRED' ? 'LISTINGS' : null;
  },
};

/**
 * La categoría de un correo, o `null` si es crítico.
 *
 * `null` significa **no preguntes**: quien recibe `null` debe mandar sin consultar
 * ninguna preferencia. Ver la cabecera.
 */
export function categoriaDe(
  job: string,
  data: Record<string, unknown>,
): EmailCategory | null {
  const clasificacion = CLASIFICACION[job as NombreDeJob];
  // Un job desconocido se trata como CRÍTICO: si algún día llega uno que no está en
  // el mapa, se manda. El fallo por defecto no puede ser silenciar.
  if (clasificacion === undefined) return null;
  return typeof clasificacion === 'function' ? clasificacion(data) : clasificacion;
}
