import type { NotificationItem } from '@/types';

/**
 * Renders a notification's text + link from its self-contained `data` snapshot
 * (no lookups). Add a case here for each new NotificationType as it ships.
 */
export function getNotificationContent(n: NotificationItem): { text: string; href: string } {
  switch (n.type) {
    case 'ALERT_MATCH':
      return {
        text: `Nuevo anuncio que coincide con tu alerta «${n.data.alertName}»: ${n.data.listingTitle}`,
        href: `/anuncio/${n.data.listingSlug}`,
      };
    case 'CONTACT_MESSAGE':
      return {
        text: `Nuevo mensaje de contacto de ${n.data.email}: «${n.data.extracto}»`,
        href: `/admin/mensajes-contacto/${n.data.messageId}`,
      };
    case 'REVIEW_REQUEST':
      return {
        text: `${n.data.otherUserName} cerró un trato contigo sobre «${n.data.listingTitle}». Puedes valorar si quieres.`,
        // target=otherUserId va en la URL porque el perfil público (GET /users/:slug)
        // no expone el id internamente — evita ensanchar esa respuesta pública
        // solo para este flujo; el id ya lo trae la propia notificación.
        href: `/vendedor/${n.data.otherUserSlug}?valorar=${encodeURIComponent(n.data.listingId ?? '')}&target=${encodeURIComponent(n.data.otherUserId)}`,
      };
    // RF.13 R4 — este tipo existía en el backend desde entonces pero NUNCA tuvo
    // su `case`: caía al default genérico "Nueva notificación", que ni decía de
    // qué iba ni llevaba a ninguna parte útil. Cerrado aquí (auditoría §1.3).
    case 'INVOICING_PENDING_FISCAL_DATA':
      return {
        text: `Tienes ${n.data.facturableCount} movimiento(s) facturable(s) del periodo ${n.data.periodKey}, pero faltan tus datos fiscales para emitir la factura.`,
        href: '/perfil/facturacion',
      };
    // Atención al usuario R4 — los tres se pintan desde el snapshot, sin ninguna
    // consulta: `extracto` ya viene acotado a 140 caracteres desde el servidor.
    case 'TICKET_MESSAGE':
      return {
        text: `Respuesta nueva en tu ticket «${n.data.subject}»: ${n.data.extracto}`,
        href: `/mis-tickets/${n.data.ticketId}`,
      };
    case 'TICKET_OPENED':
      return {
        text: `La administración ha abierto un hilo contigo: «${n.data.subject}» — ${n.data.extracto}`,
        href: `/mis-tickets/${n.data.ticketId}`,
      };
    case 'TICKET_STAFF_NEW':
      return {
        text: `${n.data.userName}${n.data.topic ? ` (${n.data.topic})` : ''}: «${n.data.subject}» — ${n.data.extracto}`,
        href: `/admin/tickets/${n.data.ticketId}`,
      };
    // ── Moderación (§14.5) ───────────────────────────────────────────────────
    case 'REPORT_RESOLVED':
      return {
        text:
          n.data.outcome === 'RESOLVED'
            ? `Hemos revisado tu denuncia sobre ${n.data.targetLabel} y hemos tomado medidas.`
            : `Hemos revisado tu denuncia sobre ${n.data.targetLabel} y no hemos encontrado motivo para actuar.`,
        // Solo hay a dónde ir si lo denunciado era un anuncio que sigue vivo.
        href: n.data.listingSlug ? `/anuncio/${n.data.listingSlug}` : '/notificaciones',
      };
    case 'LISTING_MODERATED':
      return {
        text: {
          REJECTED: `Tu anuncio «${n.data.listingTitle}» no ha pasado la revisión${n.data.reason ? `: ${n.data.reason}` : '.'}`,
          DEACTIVATED: `Hemos retirado tu anuncio «${n.data.listingTitle}»${n.data.reason ? `: ${n.data.reason}` : '.'}`,
          RESTORED: `Tu anuncio «${n.data.listingTitle}» vuelve a estar publicado.`,
        }[n.data.action],
        href: '/mis-anuncios',
      };
    case 'REVIEW_MODERATED':
      return {
        text: `Hemos retirado tu valoración de ${n.data.rating}★ sobre ${n.data.targetName}${n.data.listingTitle ? ` (${n.data.listingTitle})` : ''} por incumplir las normas.`,
        href: '/notificaciones',
      };
    default:
      return { text: 'Nueva notificación', href: '/notificaciones' };
  }
}
