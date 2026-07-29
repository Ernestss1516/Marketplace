import { MAX_FILE_SIZE, MIME_TO_EXT } from '../media/media.service';

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

// ─── R5 — ADJUNTOS (§14.7) ───────────────────────────────────────────────────

/**
 * Tipos aceptados: los MISMOS de `MediaService` **más PDF** (decisión §14.7).
 *
 * Se importa `MIME_TO_EXT` en vez de recopiar el mapa: el propio comentario de
 * `media.service.ts` invita a reutilizarlo ("exported so other upload endpoints
 * ... can reuse the same mime→ext mapping"), y dos listas de MIME permitidos que
 * se mantienen por separado acaban divergiendo. **Es una constante, no el
 * servicio**: R5 no usa `MediaService` (ver `TicketAttachmentsService`).
 */
export const TICKET_ATTACHMENT_MIME_TO_EXT: Record<string, string> = {
  ...MIME_TO_EXT,
  'application/pdf': '.pdf',
};

export const TICKET_ATTACHMENT_ALLOWED_MIME = Object.keys(TICKET_ATTACHMENT_MIME_TO_EXT);

/** 10 MB por fichero (§14.7). Mismo tamaño que media, declarado aquí a propósito. */
export const TICKET_ATTACHMENT_MAX_BYTES = MAX_FILE_SIZE;

/** Máximo 5 adjuntos por mensaje (§14.7). */
export const TICKET_ATTACHMENT_MAX_PER_MESSAGE = 5;

/**
 * DOS NIVELES DE LÍMITE, y la distinción es deliberada.
 *
 * Los de arriba son la REGLA DE NEGOCIO y los hace cumplir el servicio, que
 * responde con un 422 explicando cuál se ha pasado. Estos dos son el TOPE DE
 * MEMORIA de multer: sin ellos, una petición de 1 GB se bufferearía entera antes
 * de que ningún código nuestro pudiera opinar (multipart no pasa por el límite de
 * body de Express). Se dejan holgados a propósito para que el caso normal —el
 * usuario que se pasa un poco— reciba el 422 claro del servicio y no el error
 * crudo de multer; quien mande 100 MB no busca un mensaje de error.
 */
export const TICKET_ATTACHMENT_MULTER_MAX_BYTES = TICKET_ATTACHMENT_MAX_BYTES + 1024 * 1024;
export const TICKET_ATTACHMENT_MULTER_MAX_FILES = TICKET_ATTACHMENT_MAX_PER_MESSAGE + 5;

/** Tope del nombre original que se guarda (solo para mostrar y descargar). */
export const TICKET_ATTACHMENT_FILENAME_MAX_CHARS = 200;
