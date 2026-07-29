/**
 * Ventana de reapertura de un ticket RESOLVED (decisión §14.2 del diseño).
 *
 * Un usuario puede reabrir su ticket respondiendo (T8) mientras no hayan pasado
 * estos días desde `resolvedAt`. Pasada la ventana, responder se rechaza y hay
 * que abrir un ticket nuevo.
 *
 * OJO — el CIERRE AUTOMÁTICO de los RESOLVED vencidos es R8 (cron). Hasta
 * entonces un ticket fuera de ventana se queda en RESOLVED en la BD y es este
 * guard el único que hace cumplir la ventana. Cuando llegue R8, el cron y este
 * guard deben leer la MISMA constante — de ahí que viva aquí y no inline.
 */
export const TICKET_REOPEN_WINDOW_DAYS = 14;

/**
 * Límite de apertura de tickets por usuario y día (decisión §14.8).
 *
 * Constante y no `Setting`: a diferencia de `freeActiveListingLimit` (que el
 * admin ajusta como palanca de negocio), esto es una defensa antiabuso sin valor
 * comercial. Meterlo en `Setting` obligaría a tocar la whitelist de
 * `AdminService`, el seed y la UI de ajustes — radio de explosión sobre código
 * verde a cambio de nada. Si algún día hace falta ajustarlo en caliente, se
 * migra entonces (mismo camino que siguió `listingExpiryDays`).
 */
export const TICKET_CREATE_LIMIT_PER_DAY = 10;
export const TICKET_CREATE_WINDOW_SECONDS = 24 * 60 * 60;

/** Página por defecto del hilo (molde MessagesQueryDto: 50, máx. 100). */
export const TICKET_MESSAGES_DEFAULT_LIMIT = 50;

/**
 * Longitud máxima del extracto que viaja en una Notification o en un email (§11).
 *
 * Es el mecanismo que hace verdad —y no eslogan— que la conversación in-app sea
 * la fuente de verdad: el aviso NUNCA lleva el mensaje entero, así que para
 * leerlo hay que entrar. Mismo valor que usa `ContactService.notifyAdmins`.
 */
export const TICKET_EXCERPT_MAX_CHARS = 140;
