export type NotificationType =
  | 'ALERT_MATCH'
  | 'CONTACT_MESSAGE'
  | 'REVIEW_REQUEST'
  | 'INVOICING_PENDING_FISCAL_DATA';

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
