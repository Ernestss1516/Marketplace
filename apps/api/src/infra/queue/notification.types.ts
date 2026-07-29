export const NOTIFICATION_JOB = {
  SEND_VERIFICATION_EMAIL: 'send-verification-email',
  SEND_RESET_EMAIL: 'send-reset-email',
  SEND_ALERT_EMAIL: 'send-alert-email',
  SEND_CONTACT_NOTIFICATION: 'send-contact-notification',
  SEND_CONTACT_REPLY: 'send-contact-reply',
  SEND_REVIEW_REQUEST_EMAIL: 'send-review-request-email',
  // Atención al usuario R4
  SEND_TICKET_MESSAGE: 'send-ticket-message',
  SEND_TICKET_STAFF_NOTIFICATION: 'send-ticket-staff-notification',
  SEND_TICKET_RESOLVED: 'send-ticket-resolved',
  // Moderación (§14.5)
  SEND_LISTING_MODERATED: 'send-listing-moderated',
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

// ─── Atención al usuario R4 ───────────────────────────────────────────────────
// NINGUNO de los tres transporta la conversación: solo `extracto` (≤140) y el
// enlace al hilo (§11). Es lo que hace verdad —y no eslogan— que la conversación
// in-app sea la fuente de verdad: para leerla hay que entrar. Los tres cierran
// con "no respondas a este correo", porque además NO EXISTE email entrante en el
// proyecto (ver la auditoría §1.4): una respuesta no llegaría a ninguna parte.

/** Al usuario: el staff respondió, o abrió un hilo con él (flujos b/c). */
export interface SendTicketMessageData {
  email: string;
  name: string;
  ticketId: string;
  subject: string;
  extracto: string;
  /** true si es la apertura de un hilo por parte de la administración. */
  opened: boolean;
}

/**
 * Al buzón de soporte. UN SOLO email, no fan-out por admin — a diferencia de
 * SEND_CONTACT_NOTIFICATION (RC.1), que sí manda uno por administrador. Decisión
 * §14.4: los tickets serán bastante más frecuentes que los mensajes de contacto,
 * y multiplicar cada uno por el número de admins es ruido que no escala. El
 * aviso in-app SÍ sigue siendo fan-out (uno por agente, en su campana).
 */
export interface SendTicketStaffNotificationData {
  to: string;
  ticketId: string;
  subject: string;
  extracto: string;
  userName: string;
  /** 'new' = ticket recién abierto; 'reply' = el usuario ha contestado. */
  kind: 'new' | 'reply';
}

/**
 * Al VENDEDOR: su anuncio ha sido moderado (retirado, rechazado o restaurado).
 *
 * ES EL ÚNICO AVISO DE MODERACIÓN QUE LLEVA EMAIL, y es una decisión: al vendedor
 * le quitan (o le devuelven) presencia en el marketplace y tiene algo que hacer
 * —corregir y republicar—, y puede tardar días en entrar. Los otros dos avisos de
 * moderación (denuncia resuelta, valoración retirada) se quedan en la campana:
 * son informativos, no hay nada que hacer con ellos, y las denuncias son muchas
 * más que las moderaciones — un correo por cada una sería el camino al ruido.
 */
export interface SendListingModeratedData {
  email: string;
  name: string;
  listingTitle: string;
  action: 'REJECTED' | 'DEACTIVATED' | 'RESTORED';
  reason: string | null;
}

/** Al usuario: su ticket se ha marcado como resuelto (T7). */
export interface SendTicketResolvedData {
  email: string;
  name: string;
  ticketId: string;
  subject: string;
  /** Días de la ventana de reapertura, para que el copy no repita el número a mano. */
  reopenWindowDays: number;
}
