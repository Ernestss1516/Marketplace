export type NotificationType =
  | 'ALERT_MATCH'
  | 'CONTACT_MESSAGE'
  | 'REVIEW_REQUEST'
  | 'INVOICING_PENDING_FISCAL_DATA'
  // Atención al usuario R4 — tres tipos nuevos, SIN migración: `Notification.type`
  // es String a propósito (ver schema.prisma). Ya se validó al añadir CONTACT_MESSAGE.
  | 'TICKET_MESSAGE'
  | 'TICKET_OPENED'
  | 'TICKET_STAFF_NEW'
  // Moderación (§14.5 del diseño de atención al usuario) — hasta ahora NINGUNA
  // acción de moderación avisaba a nadie: al denunciante no se le decía en qué
  // acabó su denuncia, y a un vendedor le retiraban el anuncio del marketplace
  // sin una palabra. Tampoco requieren migración: `type` es String.
  | 'REPORT_RESOLVED'
  | 'LISTING_MODERATED'
  | 'REVIEW_MODERATED'
  // Bump automático (proyecto 2) — tampoco requiere migración: `type` es String.
  // SOLO se avisa de INCIDENCIAS (D6): un bump aplicado no notifica, porque es lo que el
  // usuario contrató y avisar de cada uno inundaría la campana. Lo que sí exige enterarse
  // es que la programación DEJÓ de correr, que es lo que este tipo cuenta.
  | 'BUMP_AUTO_PAUSED'
  // NOTIFICACIONES A1 — EL TIPO QUE FALTABA EN SU PROPIO REGISTRO.
  //
  // `DATA_EXPORT_READY` se creaba desde C6 con `prisma.notification.create()`
  // directo, saltándose `createNotification()`. Al no pasar por el servicio tipado
  // nunca llegó aquí, ni a la unión del front, ni tuvo su `case`: la exportación se
  // avisaba como «Nueva notificación», sin decir qué era ni llevar a la descarga.
  //
  // Ahora entra por la puerta y `PrismaService` cierra la de atrás: crear una
  // `Notification` fuera del servicio ya no compila (ver `prisma.service.ts`).
  | 'DATA_EXPORT_READY';

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

// ─── Moderación (§14.5) ───────────────────────────────────────────────────────
// Mismos dos principios que el resto: snapshot AUTOCONTENIDO con nombres ya
// resueltos (nunca ids que haya que resolver al pintar), y superviviencia — un
// aviso sobre un anuncio retirado debe seguir siendo legible aunque el anuncio
// se borre después.

/** Al DENUNCIANTE: en qué acabó la denuncia que puso. */
export interface ReportResolvedData {
  reportId: string;
  outcome: 'RESOLVED' | 'DISMISSED';
  /** Qué se denunció. Determina cómo se redacta el aviso. */
  targetType: 'LISTING' | 'REVIEW' | 'USER';
  /** Nombre YA RESUELTO de lo denunciado (título del anuncio, nombre del usuario…). */
  targetLabel: string;
  /** Slug para enlazar, solo si lo denunciado era un anuncio que sigue vivo. */
  listingSlug: string | null;
}

/** Al VENDEDOR: su anuncio ha sido moderado. */
export interface ListingModeratedData {
  listingId: string;
  /** Título CONGELADO — el aviso sobrevive al borrado del anuncio. */
  listingTitle: string;
  /** `APPROVED` entró con la moderación previa (M2): pasó la revisión y ya está publicado. */
  action: 'APPROVED' | 'REJECTED' | 'DEACTIVATED' | 'RESTORED';
  /** Motivo que escribió el moderador, si lo puso. */
  reason: string | null;
}

/**
 * Bump automático — la programación de un anuncio se ha PARADO y hace falta que el usuario
 * haga algo. Mismo criterio que el resto: snapshot AUTOCONTENIDO con el título YA RESUELTO,
 * para que el aviso siga siendo legible aunque el anuncio se borre después.
 *
 * `reason` decide cómo se redacta y qué salida se ofrece: recargar saldo no es lo mismo que
 * reactivar el anuncio. Por eso la razón viaja en el aviso y no solo en el estado.
 */
export interface BumpAutoPausedData {
  scheduleId: string;
  listingId: string;
  /** Título CONGELADO — sobrevive al borrado del anuncio. */
  listingTitle: string;
  reason: 'NO_FUNDS' | 'LISTING_INACTIVE';
}

/**
 * Al AUTOR de una valoración: el equipo ha intervenido sobre ella.
 *
 * ── `action` NACE EN A1, Y NACE PARA QUE EL AVISO DEJE DE MENTIR ─────────────
 *
 * Este tipo se escribió para la RETIRADA, y su texto lo decía: «hemos retirado tu
 * valoración… por incumplir las normas». Pero `editReview` —que NO retira nada,
 * sólo recorta el texto o corrige las estrellas de una valoración que sigue
 * publicada— reutilizaba el mismo aviso. El autor recibía una afirmación **falsa
 * sobre el estado de su propia valoración**, y encima desde el método que más
 * cuidado pone en no mentir al lector sobre quién escribió qué (por eso `edit()`
 * de moderación no toca `editedAt`).
 *
 * La variante se resuelve con un discriminante y no con un tipo nuevo, siguiendo
 * el molde de `ListingModeratedData.action`: son la misma clase de evento —«el
 * equipo ha tocado algo tuyo»— y comparten destinatario, enlace y snapshot.
 *
 * PENDIENTE ANOTADO (siguiente ráfaga, «cuenta+motivo»): las dos acciones exigen
 * un `reason` obligatorio en el servicio (`retireReview` y `editReview` lo piden
 * con `@MinLength(5)`) y ese motivo **hoy se descarta** — sólo llega al
 * `AuditLog`. Traerlo hasta aquí es exactamente el patrón que ya funciona en
 * `ListingModeratedData.reason`, y es el trabajo de la ráfaga que viene, no de A1.
 */
export interface ReviewModeratedData {
  reviewId: string;
  rating: number;
  /** Sobre qué anuncio era, congelado (Review.listingTitle ya es un snapshot). */
  listingTitle: string | null;
  /** Nombre del usuario valorado, resuelto. */
  targetName: string;
  /**
   * Qué se le hizo. `RETIRED`: deja de verse (reversible con `restoreReview`).
   * `EDITED`: sigue publicada, con el texto o las estrellas cambiados.
   */
  action: 'RETIRED' | 'EDITED';
}

/**
 * BORRADO DE CUENTAS C6 — el ZIP está listo para descargar.
 *
 * Snapshot autocontenido como el resto: `expiresAt` y `sizeBytes` van CONGELADOS
 * porque el aviso tiene que seguir siendo legible cuando la exportación haya
 * caducado y su fila ya no exista. Y son justo los dos datos que importan: el ZIP
 * **caduca**, así que un aviso que no diga hasta cuándo sirve la mitad.
 */
export interface DataExportReadyData {
  exportId: string;
  /** ISO-8601. Congelado: el aviso sobrevive al borrado de la exportación. */
  expiresAt: string;
  sizeBytes: number;
}
