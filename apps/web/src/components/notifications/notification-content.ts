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
    default:
      return { text: 'Nueva notificación', href: '/notificaciones' };
  }
}
