export type NotificationType =
  | 'ALERT_MATCH'
  | 'CONTACT_MESSAGE'
  | 'REVIEW_REQUEST'
  | 'INVOICING_PENDING_FISCAL_DATA'
  // Atención al usuario R4 — tres tipos nuevos, SIN migración: `Notification.type`
  // es String a propósito (ver schema.prisma). Ya se validó al añadir CONTACT_MESSAGE.
  | 'TICKET_MESSAGE'
  | 'TICKET_OPENED'
  | 'TICKET_STAFF_NEW';

/** Self-contained snapshot stored in Notification.data — see schema.prisma comment. */
export interface AlertMatchData {
  alertId: string;
  alertName: string;
  listingId: string;
  listingSlug: string;
  listingTitle: string;
}

/** RC.1 — fan-out: una Notification por cada User con role ADMIN, no un buzón
 * compartido (Notification es userId 1:1, ver schema.prisma). Self-contained
 * snapshot — sobrevive aunque el ContactMessage cambie de estado después. */
export interface ContactMessageData {
  messageId: string;
  motivo: string;
  email: string;
  extracto: string;
}

/** Reputación RÁFAGA 3 — self-contained, mismo criterio que AlertMatchData:
 * sobrevive aunque el Deal/Listing cambien después. dealId no es necesario
 * para acceder al recurso (a diferencia de alertId/messageId, no hay una
 * página propia de "el Deal") — solo para trazabilidad. */
export interface ReviewRequestData {
  dealId: string;
  listingId: string | null;
  listingTitle: string;
  otherUserId: string;
  otherUserName: string;
  otherUserSlug: string;
}

/** RF.13 R4 — el cron detecta movimientos facturables de un periodo cerrado pero
 * el usuario no tiene datos fiscales completos: no se le puede emitir factura.
 * Se le avisa para que los complete y facture manualmente (R3) dentro de la ventana. */
export interface InvoicingPendingFiscalDataData {
  periodKey: string;
  facturableCount: number;
}

// ─── Atención al usuario R4 ───────────────────────────────────────────────────
// Los tres son SNAPSHOTS AUTOCONTENIDOS, regla invariante del proyecto: se
// guardan NOMBRES YA RESUELTOS (`userName`, `topic`), nunca ids que haya que
// resolver al renderizar. La notificación debe pintarse sin una sola consulta
// extra y seguir siendo legible aunque el motivo se renombre o el ticket cambie
// de estado después — mismo criterio que hizo que ContactService.notifyAdmins
// reciba el nombre del motivo y no el motivoId (RC.2).
//
// `extracto` es de ≤140 caracteres A PROPÓSITO (§11): ni la notificación ni el
// email transportan la conversación. Avisan y reenganchan; leerla exige entrar.

/** Al USUARIO: el staff ha respondido en su ticket. */
export interface TicketMessageData {
  ticketId: string;
  subject: string;
  extracto: string;
  /** Estado CONGELADO en el instante del aviso — no se relee del ticket al pintar. */
  status: string;
}

/** Al USUARIO: la administración ha abierto un hilo con él (flujos b y c). */
export interface TicketOpenedData {
  ticketId: string;
  subject: string;
  extracto: string;
}

/** Fan-out al STAFF: ticket nuevo de un usuario, o respuesta suya en WAITING_USER. */
export interface TicketStaffNewData {
  ticketId: string;
  subject: string;
  extracto: string;
  /** Nombre del usuario, resuelto. Nunca su id. */
  userName: string;
  /** Nombre del motivo, resuelto. Null si el ticket no lleva motivo. */
  topic: string | null;
}
