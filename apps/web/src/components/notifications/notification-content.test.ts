import { getNotificationContent } from './notification-content';
import type { NotificationItem } from '@/types';

/**
 * NOTIFICACIONES A1 — QUE NINGÚN AVISO SALGA VACÍO NI MIENTA.
 *
 * Los dos defectos que cubre este fichero se comportaban igual de mal y por
 * caminos opuestos: uno pintaba `undefined` (una clave que faltaba en un mapa) y
 * otro pintaba un texto perfecto pero FALSO (un `case` que daba por hecho que
 * toda moderación era una retirada). Los dos pasaron desapercibidos porque nada
 * miraba el texto que acaba viendo la persona.
 *
 * La red principal es el COMPILADOR —un `case` que falte o una clave de variante
 * que falte no compilan, ver la cabecera de `notification-content.ts`—. Esto es lo
 * que el compilador no puede comprobar: que lo que se pinta **dice la verdad**.
 */

const base = {
  id: 'n1',
  userId: 'u1',
  read: false,
  readAt: null,
  createdAt: '2026-08-01T10:00:00.000Z',
};

/** El texto del `default`: aparecer aquí es el síntoma exacto del defecto. */
const GENERICO = 'Nueva notificación';

describe('getNotificationContent', () => {
  // ===========================================================================
  // DEFECTO 1 — el aviso invisible
  // ===========================================================================

  describe('DATA_EXPORT_READY (creado desde C6, sin `case` hasta A1)', () => {
    const aviso: NotificationItem = {
      ...base,
      type: 'DATA_EXPORT_READY',
      data: {
        exportId: 'exp-1',
        expiresAt: '2026-09-04T10:00:00.000Z',
        sizeBytes: 5 * 1024 * 1024,
      },
    };

    it('no cae en el genérico: dice qué es y cuánto ocupa', () => {
      const { text } = getNotificationContent(aviso);
      expect(text).not.toBe(GENERICO);
      expect(text).toContain('copia de datos');
      expect(text).toContain('5.0 MB');
    });

    it('dice hasta cuándo, porque la exportación CADUCA', () => {
      expect(getNotificationContent(aviso).text).toContain('4 de septiembre');
    });

    it('lleva a /perfil, donde está el botón que descarga el ZIP', () => {
      // No hay ruta propia de descarga: va con el token desde `ExportarDatosPanel`.
      expect(getNotificationContent(aviso).href).toBe('/perfil');
    });
  });

  // ===========================================================================
  // DEFECTO 2 — la variante que pintaba `undefined`
  // ===========================================================================

  describe('LISTING_MODERATED', () => {
    const conAccion = (
      action: 'APPROVED' | 'REJECTED' | 'DEACTIVATED' | 'RESTORED',
      reason: string | null = null,
    ): NotificationItem => ({
      ...base,
      type: 'LISTING_MODERATED',
      data: { listingId: 'l1', listingTitle: 'Bici de carretera', action, reason },
    });

    it('APPROVED tiene texto: era la clave que faltaba y salía `undefined`', () => {
      const { text } = getNotificationContent(conAccion('APPROVED'));
      expect(text).toBeDefined();
      expect(text).toContain('Bici de carretera');
      // Alineado con el asunto del correo del mismo hecho (§A1.3).
      expect(text).toContain('ya está publicado');
    });

    it('las CUATRO acciones pintan texto, ninguna `undefined`', () => {
      for (const action of ['APPROVED', 'REJECTED', 'DEACTIVATED', 'RESTORED'] as const) {
        const { text } = getNotificationContent(conAccion(action));
        expect(typeof text).toBe('string');
        expect(text).not.toContain('undefined');
        expect(text.length).toBeGreaterThan(0);
      }
    });

    it('el motivo se muestra cuando lo hay, y no estorba cuando no', () => {
      expect(getNotificationContent(conAccion('REJECTED', 'Fotos borrosas')).text).toContain(
        'Fotos borrosas',
      );
      expect(getNotificationContent(conAccion('REJECTED')).text).not.toContain('undefined');
    });
  });

  // ===========================================================================
  // DEFECTO 3 — el aviso que mentía
  // ===========================================================================

  describe('REVIEW_MODERATED', () => {
    const conAccion = (action: 'RETIRED' | 'EDITED'): NotificationItem => ({
      ...base,
      type: 'REVIEW_MODERATED',
      data: {
        reviewId: 'r1',
        rating: 4,
        listingTitle: 'Mesa de roble',
        targetName: 'Ana',
        action,
      },
    });

    it('RETIRED dice que se retiró', () => {
      expect(getNotificationContent(conAccion('RETIRED')).text).toContain('retirado');
    });

    it('EDITED NO dice que se retiró: la valoración sigue publicada', () => {
      const { text } = getNotificationContent(conAccion('EDITED'));
      expect(text).not.toContain('retirado');
      expect(text).toContain('editado');
      expect(text).toContain('Sigue publicada');
    });
  });

  // ===========================================================================
  // Ningún tipo conocido cae en el genérico
  // ===========================================================================

  it('ningún tipo del sistema se pinta como «Nueva notificación»', () => {
    // Un ejemplar mínimo de cada miembro de la unión. Si se añade un tipo nuevo,
    // el `switch` ya no compila — esto comprueba lo otro: que los que hay pintan.
    const ejemplares: NotificationItem[] = [
      { ...base, type: 'ALERT_MATCH', data: { alertId: 'a', alertName: 'Bicis', listingId: 'l', listingSlug: 's', listingTitle: 'T' } },
      { ...base, type: 'CONTACT_MESSAGE', data: { messageId: 'm', motivo: 'Dudas', email: 'a@b.c', extracto: 'Hola' } },
      { ...base, type: 'REVIEW_REQUEST', data: { dealId: 'd', listingId: 'l', listingTitle: 'T', otherUserId: 'u', otherUserName: 'Ana', otherUserSlug: 'ana' } },
      { ...base, type: 'INVOICING_PENDING_FISCAL_DATA', data: { periodKey: '2026-07', facturableCount: 2 } },
      { ...base, type: 'TICKET_MESSAGE', data: { ticketId: 't', subject: 'S', extracto: 'E', status: 'OPEN' } },
      { ...base, type: 'TICKET_OPENED', data: { ticketId: 't', subject: 'S', extracto: 'E' } },
      { ...base, type: 'TICKET_STAFF_NEW', data: { ticketId: 't', subject: 'S', extracto: 'E', userName: 'Ana', topic: null } },
      { ...base, type: 'REPORT_RESOLVED', data: { reportId: 'r', outcome: 'RESOLVED', targetType: 'LISTING', targetLabel: 'Un anuncio', listingSlug: 's' } },
      { ...base, type: 'LISTING_MODERATED', data: { listingId: 'l', listingTitle: 'T', action: 'APPROVED', reason: null } },
      { ...base, type: 'REVIEW_MODERATED', data: { reviewId: 'r', rating: 3, listingTitle: null, targetName: 'Ana', action: 'RETIRED' } },
      { ...base, type: 'BUMP_AUTO_PAUSED', data: { scheduleId: 'b', listingId: 'l', listingTitle: 'T', reason: 'NO_FUNDS' } },
      { ...base, type: 'DATA_EXPORT_READY', data: { exportId: 'e', expiresAt: '2026-09-04T10:00:00.000Z', sizeBytes: 1024 } },
    ];

    for (const n of ejemplares) {
      const { text, href } = getNotificationContent(n);
      expect({ type: n.type, text }).not.toEqual({ type: n.type, text: GENERICO });
      expect(href.startsWith('/')).toBe(true);
    }
  });
});
