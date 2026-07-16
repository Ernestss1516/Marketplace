export const NOTIFICATION_JOB = {
  SEND_VERIFICATION_EMAIL: 'send-verification-email',
  SEND_RESET_EMAIL: 'send-reset-email',
  SEND_ALERT_EMAIL: 'send-alert-email',
  SEND_CONTACT_NOTIFICATION: 'send-contact-notification',
  SEND_CONTACT_REPLY: 'send-contact-reply',
  SEND_REVIEW_REQUEST_EMAIL: 'send-review-request-email',
} as const;

export interface SendVerificationEmailData {
  userId: string;
  email: string;
  name: string;
  token: string;
}

export interface SendResetEmailData {
  email: string;
  name: string;
  token: string;
}

export interface SendAlertEmailData {
  email: string;
  name: string;
  alertName: string;
  listingTitle: string;
  listingSlug: string;
}

/** RC.1 — aviso al admin de un nuevo mensaje de contacto. Un job por admin
 * (mismo fan-out que las Notification in-app), no un solo job con lista de
 * destinatarios — si el email de un admin falla, BullMQ reintenta solo ese job. */
export interface SendContactNotificationData {
  adminEmail: string;
  adminName: string;
  messageId: string;
  motivo: string;
  remitenteEmail: string;
  extracto: string;
}

/** RC.1 — respuesta del admin al remitente. `to` viene siempre de
 * ContactMessage.email (inmutable), nunca de un campo libre — cierra el vector
 * de email header injection. */
export interface SendContactReplyData {
  to: string;
  asunto: string;
  cuerpo: string;
}

/** Reputación RÁFAGA 3 — aviso al cerrar un Deal (bidireccional: un job por
 * cada parte que puede valorar). Copy deliberadamente sin presión ni plazo
 * — valorar es opcional, la ventana es indefinida. */
export interface SendReviewRequestEmailData {
  email: string;
  name: string;
  otherUserName: string;
  listingTitle: string;
  listingSlug: string;
}
