/**
 * Ventana de reapertura de un ticket RESOLVED (decisión §14.2 del diseño), en
 * días. Es el DEFAULT: el valor vigente vive en `Setting.ticketAutoCloseWindowDays`
 * y se puede cambiar en caliente desde el backoffice (molde
 * `fiscalInvoicingPeriodicity`). Sin configurar, manda este 14.
 *
 * UN SOLO VALOR PARA DOS COSAS, y no por casualidad: el guard de reapertura (T8,
 * `TicketsService.assertWithinReopenWindow`) y el cron de cierre automático (T9,
 * `TicketsScheduleService`) leen EL MISMO Setting. Si divergieran, habría un
 * limbo — un ticket que el cron ya cerró pero que la UI seguiría ofreciendo
 * reabrir, o al revés. Por eso la lectura está centralizada en
 * `TicketsService.getReopenWindowDays()` y nadie más resuelve el número.
 */
export const TICKET_REOPEN_WINDOW_DAYS = 14;

/** Clave `Setting` de la ventana. Compartida por el guard de T8 y el cron de T9. */
export const TICKET_WINDOW_SETTING_KEY = 'ticketAutoCloseWindowDays';

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
