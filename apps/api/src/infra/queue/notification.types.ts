import type {
  AccountModeratedAction,
  ListingLifecycleAction,
} from '../../modules/notifications/notification.types';

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
  // Bump automático (proyecto 2)
  SEND_BUMP_AUTO_PAUSED: 'send-bump-auto-paused',
  // Decisiones sobre la cuenta (N2)
  SEND_ACCOUNT_MODERATED: 'send-account-moderated',
  // Ciclo de vida del anuncio (N3)
  SEND_LISTING_LIFECYCLE: 'send-listing-lifecycle',
  // Reputación (N4a)
  SEND_REVIEW_RECEIVED: 'send-review-received',
  // Mensajería (N4b) — el correo AGRUPADO, tras la ventana de gracia.
  SEND_MESSAGE_UNREAD: 'send-message-unread',
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

/**
 * Reputación RÁFAGA 3 — aviso al cerrar un Deal (bidireccional: un job por cada
 * parte que puede valorar). Copy deliberadamente sin presión ni plazo — valorar es
 * opcional, la ventana es indefinida.
 *
 * ── NOTIFICACIONES A1: EL ENLACE DEJA DE LLEVAR AL ANUNCIO ──────────────────
 *
 * Este correo apuntaba a `/anuncio/{listingSlug}`, y **daba 404 en todos los
 * tratos de producto**: `closeDeal` deja el anuncio en `SOLD` y la ficha pública
 * sólo sirve los `ACTIVE`. O sea que el enlace de «valora tu trato» se rompía
 * justo por cerrar el trato del que hablaba.
 *
 * Es el mismo defecto de clase que `lib/admin-links.ts` erradicó en el backoffice
 * —una ruta que 404 para todo lo que no esté `ACTIVE`—, sobrevivido en el correo
 * porque aquel helper vive en el front y este processor está en el back.
 *
 * Ahora lleva al MISMO destino que la notificación in-app: el perfil del otro con
 * el deep-link de valoración, que la página documenta como «el único punto de
 * entrada para valorar un Deal sin conversación» y que no depende del estado del
 * anuncio. De paso, los dos canales dejan de decir cosas distintas (§A1.3).
 *
 * `listingSlug` YA NO VIAJA: sin uso, sería una invitación a volver a enlazarlo.
 */
export interface SendReviewRequestEmailData {
  email: string;
  name: string;
  otherUserName: string;
  listingTitle: string;
  /** Slug del OTRO (a cuyo perfil se va a valorar), no del anuncio. */
  otherUserSlug: string;
  /** A quién se valora. El perfil público no expone ids, así que viaja en el enlace. */
  otherUserId: string;
  /** Sobre qué anuncio fue el trato. `null` si el anuncio ya no existe. */
  listingId: string | null;
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
  action: 'APPROVED' | 'REJECTED' | 'DEACTIVATED' | 'RESTORED';
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

/**
 * Bump automático — la programación de un anuncio se ha parado (D6: solo incidencias).
 * El email lleva la razón porque la salida que se ofrece depende de ella: recargar saldo no
 * es lo mismo que reactivar el anuncio.
 */
export interface SendBumpAutoPausedData {
  email: string;
  name: string;
  listingId: string;
  /** Título congelado, igual que en la notificación in-app. */
  listingTitle: string;
  reason: 'NO_FUNDS' | 'LISTING_INACTIVE';
}

/**
 * NOTIFICACIONES N2 — LA DECISIÓN SOBRE LA CUENTA, POR CORREO.
 *
 * ── AQUÍ EL CORREO NO ES EL AUXILIAR: ES EL ÚNICO CANAL ─────────────────────
 *
 * En el resto del sistema la regla es «la campana informa, el correo reengancha».
 * Con las sanciones de cuenta se invierte, y no por gusto: `SUSPENDED`, `BANNED` y
 * `ARCHIVED` **no pueden entrar** —los rechaza el gate de `account-access.ts` en
 * las tres puertas—, así que no hay campana que puedan abrir. Si este correo no
 * sale, la persona se entera de que la han sancionado **chocando contra el login**,
 * sin saber por qué ni durante cuánto.
 *
 * Por eso `sancion-email-unico-canal` (e2e) lo fija: banear sin encolar este job
 * es dejar a alguien sin ningún aviso.
 *
 * ── `DELETED` SÓLO EXISTE AQUÍ ──────────────────────────────────────────────
 *
 * La unión de esta interfaz tiene una acción más que la del aviso in-app
 * (`AccountModeratedAction`): eliminar una cuenta **borra todas sus
 * notificaciones**, así que un aviso in-app de su propia eliminación se destruiría
 * en la misma transacción. El correo es el único que sobrevive, y se manda con la
 * dirección leída ANTES de vaciar la fila.
 *
 * ── EL MOTIVO QUE VIAJA ES EL VISIBLE ───────────────────────────────────────
 *
 * `reason` es `User.sanctionReason`. La nota interna NO tiene campo en esta
 * interfaz, a propósito: no hay dónde meterla ni por descuido.
 */
/**
 * NOTIFICACIONES N3 — el ciclo de vida del anuncio, por correo.
 *
 * ── QUÉ EVENTOS LLEVAN CORREO Y CUÁLES NO ──────────────────────────────────
 *
 * El criterio del proyecto, que ya está escrito en la auditoría (§A4): **correo
 * cuando el usuario pierde algo o tiene algo que hacer, y puede tardar días en
 * entrar**. In-app a secas cuando es informativo y no hay nada que hacer.
 *
 * LLEVAN CORREO:
 *   · `EXPIRED` — perdió presencia sin hacer nada, y hay una salida clara: renovar.
 *   · `EXPIRING_SOON` — todo el sentido del preaviso es alcanzar a quien NO está
 *     mirando. Un preaviso que sólo vive en la campana avisa exactamente a quien
 *     se habría enterado igual.
 *   · `EDITED_BY_STAFF` — le han cambiado el texto o el precio de algo suyo.
 *   · `DELETED_BY_STAFF` — irreversible, y no lo hizo él.
 *
 * NO LLEVAN, y el `action` de esta interfaz no los incluye para que no puedan
 * colarse por descuido:
 *   · `RECEIVED` — es un acuse. Acaba de pulsar «publicar» y la pantalla ya se lo
 *     dijo; un correo por cada publicación es la vía rápida al ruido.
 *   · `FEATURED_EXPIRED` — se acaba algo contratado por un plazo que él eligió, no
 *     se pierde nada que tuviera. Por correo se parecería demasiado a una oferta
 *     para volver a comprar, que es justo lo que estos avisos no son.
 */
export interface SendListingLifecycleData {
  email: string;
  name: string;
  /** Congelado, igual que en la notificación in-app. */
  listingTitle: string;
  /** Sólo los cuatro que llevan correo. Ver la cabecera. */
  action: Extract<
    ListingLifecycleAction,
    'EXPIRING_SOON' | 'EXPIRED' | 'EDITED_BY_STAFF' | 'DELETED_BY_STAFF'
  >;
  reason: string | null;
  daysLeft: number | null;
}

/**
 * NOTIFICACIONES N4a — te han valorado.
 *
 * ── POR QUÉ SÍ LLEVA CORREO, PESE AL «con moderación» DE §A4 ────────────────
 *
 * La auditoría marcó este aviso para correo pero con reserva, por miedo al
 * volumen. Ese miedo no aplica aquí, y el modelo lo garantiza: para valorar a
 * alguien hace falta **un `Deal` cerrado** con él sobre un anuncio concreto, y
 * `Review` tiene `@@unique([authorId, targetId, listingId])`. O sea que el número
 * de correos posibles está acotado por el número de tratos reales, y **nadie puede
 * valorar dos veces el mismo**. No es un canal que se pueda inundar.
 *
 * Y el hecho lo merece: queda escrito en público, cuenta para la media y no se
 * puede responder — enterarse tres semanas tarde, al entrar por casualidad, es
 * peor que un correo.
 *
 * NO LLEVA EL COMENTARIO, sólo las estrellas y el enlace. Igual que el resto del
 * processor: el correo avisa, no transporta el contenido.
 */
export interface SendReviewReceivedData {
  email: string;
  name: string;
  rating: number;
  /** Nombre del autor, ya resuelto. */
  authorName: string;
  /** Perfil del VALORADO (donde se lee la valoración), no del autor. */
  targetSlug: string;
  listingTitle: string | null;
}

/**
 * NOTIFICACIONES N4b — «tienes N mensajes de Juan», tras la ventana de gracia.
 *
 * UNO POR CONVERSACIÓN Y POR VENTANA, nunca uno por mensaje: los N acumulados van
 * en el mismo correo. Es lo que separa un aviso de una notificación push por cada
 * frase que el otro escribe.
 *
 * Sólo se encola cuando el trabajo diferido ha comprobado que **sigue sin leer**
 * (ver `MessageDigestProcessor`): cuando llega aquí, ya está decidido.
 *
 * Lleva `extracto` (≤140) y el enlace, jamás la conversación — §11, la misma regla
 * que tickets: para leerla hay que entrar.
 */
export interface SendMessageUnreadData {
  email: string;
  name: string;
  conversationId: string;
  /** Nombre del interlocutor, ya resuelto. */
  otherUserName: string;
  unreadCount: number;
  extracto: string;
}

export interface SendAccountModeratedData {
  email: string;
  name: string;
  action: AccountModeratedAction | 'DELETED';
  /** El motivo VISIBLE. Nunca la nota interna. `null` = no se indicó. */
  reason: string | null;
  /** Sólo en `SUSPENDED`: ISO-8601, o `null` si es indefinida. */
  suspendedUntil: string | null;
  /** Sólo en `ROLE_CHANGED`: el rol nuevo ya resuelto. */
  newRole: string | null;
}
