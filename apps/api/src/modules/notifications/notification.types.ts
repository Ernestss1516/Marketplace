export type NotificationType = 'ALERT_MATCH' | 'CONTACT_MESSAGE';

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
