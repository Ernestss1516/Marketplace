import { getNotificationContent } from './notification-content';
import type {
  AccountModeratedAction,
  AccountModeratedData,
  ListingLifecycleAction,
  ListingLifecycleData,
  NotificationItem,
  ReviewReceivedData,
} from '@/types';

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
    const conAccion = (
      action: 'RETIRED' | 'EDITED' | 'RESTORED',
      reason: string | null = null,
    ): NotificationItem => ({
      ...base,
      type: 'REVIEW_MODERATED',
      data: {
        reviewId: 'r1',
        rating: 4,
        listingTitle: 'Mesa de roble',
        targetName: 'Ana',
        action,
        reason,
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

    // N2 — el motivo que el moderador escribe obligatoriamente y que hasta ahora
    // se descartaba: se retiraba lo que alguien había escrito sin decirle por qué.
    it('N2 — muestra el motivo cuando lo hay, en las dos acciones', () => {
      expect(getNotificationContent(conAccion('RETIRED', 'Insultos')).text).toContain('Insultos');
      expect(getNotificationContent(conAccion('EDITED', 'Dato personal')).text).toContain(
        'Dato personal',
      );
    });

    it('N2 — sin motivo se lee igual de bien (degradación limpia)', () => {
      for (const action of ['RETIRED', 'EDITED'] as const) {
        const { text } = getNotificationContent(conAccion(action));
        expect(text).not.toContain('undefined');
        expect(text).not.toContain('null');
        expect(text).not.toContain('Motivo:');
      }
    });

    /**
     * N4a — LA ASIMETRÍA, CERRADA. Retirar avisaba; devolver la valoración no.
     * «Avisar solo de lo malo sería la mitad de la conversación».
     */
    it('N4a — RESTORED dice que vuelve a estar publicada, y no acusa', () => {
      const { text } = getNotificationContent(conAccion('RESTORED'));
      expect(text).toContain('vuelve a estar publicada');
      expect(text).not.toContain('retirado');
      expect(text).not.toContain('incumplir');
    });

    it('N4a — las TRES acciones pintan texto, ninguna `undefined`', () => {
      for (const action of ['RETIRED', 'EDITED', 'RESTORED'] as const) {
        const { text } = getNotificationContent(conAccion(action));
        expect(typeof text).toBe('string');
        expect(text).not.toContain('undefined');
        expect(text.length).toBeGreaterThan(0);
      }
    });
  });

  // ===========================================================================
  // N4a — te han valorado
  // ===========================================================================

  describe('REVIEW_RECEIVED (N4a)', () => {
    const aviso = (extra: Partial<ReviewReceivedData> = {}): NotificationItem => ({
      ...base,
      type: 'REVIEW_RECEIVED',
      data: {
        reviewId: 'r1',
        rating: 5,
        authorName: 'Ana',
        authorSlug: 'ana',
        listingTitle: 'Bici de carretera',
        ...extra,
      },
    });

    it('dice quién, cuántas estrellas y sobre qué', () => {
      const { text } = getNotificationContent(aviso());
      expect(text).toContain('Ana');
      expect(text).toContain('5 estrellas');
      expect(text).toContain('Bici de carretera');
    });

    it('una estrella no se dice «1 estrellas»', () => {
      expect(getNotificationContent(aviso({ rating: 1 })).text).toContain('1 estrella');
      expect(getNotificationContent(aviso({ rating: 1 })).text).not.toContain('1 estrellas');
    });

    it('sin anuncio se lee igual de bien (degradación limpia)', () => {
      const { text } = getNotificationContent(aviso({ listingTitle: null }));
      expect(text).not.toContain('null');
      expect(text).not.toContain('undefined');
      expect(text).toContain('Ana');
    });

    it('lleva al perfil del autor cuando se puede', () => {
      expect(getNotificationContent(aviso()).href).toBe('/vendedor/ana');
    });

    /** Si la cuenta del autor se vació, no se inventa un enlace roto (lección A1.2). */
    it('sin slug del autor NO enlaza un perfil que no existe', () => {
      expect(getNotificationContent(aviso({ authorSlug: null })).href).toBe('/notificaciones');
    });
  });

  // ===========================================================================
  // N2 — las decisiones sobre la cuenta, que no avisaban a nadie
  // ===========================================================================

  describe('ACCOUNT_MODERATED (N2)', () => {
    const conAccion = (
      action: AccountModeratedAction,
      extra: Partial<AccountModeratedData> = {},
    ): NotificationItem => ({
      ...base,
      type: 'ACCOUNT_MODERATED',
      data: { action, reason: null, suspendedUntil: null, newRole: null, ...extra },
    });

    const TODAS: AccountModeratedAction[] = [
      'SUSPENDED',
      'UNSUSPENDED',
      'BANNED',
      'REINSTATED',
      'ARCHIVED',
      'ROLE_CHANGED',
    ];

    it('las seis acciones pintan texto, ninguna `undefined`', () => {
      for (const action of TODAS) {
        const { text, href } = getNotificationContent(conAccion(action));
        expect(typeof text).toBe('string');
        expect(text).not.toContain('undefined');
        expect(text.length).toBeGreaterThan(0);
        expect(href.startsWith('/')).toBe(true);
      }
    });

    it('el motivo VISIBLE se muestra en las sanciones', () => {
      expect(getNotificationContent(conAccion('SUSPENDED', { reason: 'Spam' })).text).toContain(
        'Spam',
      );
      expect(getNotificationContent(conAccion('BANNED', { reason: 'Fraude' })).text).toContain(
        'Fraude',
      );
      expect(getNotificationContent(conAccion('ARCHIVED', { reason: 'A petición' })).text).toContain(
        'A petición',
      );
    });

    it('sin motivo se lee igual de bien (degradación limpia, molde LISTING_MODERATED)', () => {
      for (const action of TODAS) {
        const { text } = getNotificationContent(conAccion(action));
        expect(text).not.toContain('null');
        expect(text).not.toContain('Motivo:');
      }
    });

    /**
     * BARRERA 4 — reinstaurar avisa de los anuncios.
     *
     * Levantar un ban devuelve el ACCESO pero NO reactiva los anuncios: los pausó
     * la sanción y los reactiva su dueño. Quien no lo sepa vuelve, encuentra su
     * escaparate vacío y da por hecho que la plataforma está rota.
     */
    it('REINSTATED dice que los anuncios NO vuelven solos, y lleva a ellos', () => {
      const { text, href } = getNotificationContent(conAccion('REINSTATED'));
      expect(text).toContain('NO se reactivan solos');
      expect(text).toContain('Mis anuncios');
      expect(href).toBe('/mis-anuncios');
    });

    it('ROLE_CHANGED nombra el rol nuevo cuando viene', () => {
      expect(getNotificationContent(conAccion('ROLE_CHANGED', { newRole: 'MODERATOR' })).text).toContain(
        'MODERATOR',
      );
    });
  });

  // ===========================================================================
  // N3 — el ciclo de vida del anuncio, que era mudo
  // ===========================================================================

  describe('LISTING_LIFECYCLE (N3)', () => {
    const conAccion = (
      action: ListingLifecycleAction,
      extra: Partial<ListingLifecycleData> = {},
    ): NotificationItem => ({
      ...base,
      type: 'LISTING_LIFECYCLE',
      data: {
        listingId: 'l1',
        listingTitle: 'Bici de carretera',
        action,
        reason: null,
        daysLeft: null,
        ...extra,
      },
    });

    const TODAS: ListingLifecycleAction[] = [
      'RECEIVED',
      'EXPIRING_SOON',
      'EXPIRED',
      'EDITED_BY_STAFF',
      'DELETED_BY_STAFF',
      'FEATURED_EXPIRED',
    ];

    it('las seis acciones pintan texto con el título, ninguna `undefined`', () => {
      for (const action of TODAS) {
        const { text } = getNotificationContent(conAccion(action, { daysLeft: 3 }));
        expect(typeof text).toBe('string');
        expect(text).not.toContain('undefined');
        expect(text).toContain('Bici de carretera');
      }
    });

    /**
     * Todos a `/mis-anuncios` y ninguno a `/anuncio/{slug}`: la ficha pública
     * sirve sólo los ACTIVE y aquí casi ninguno lo está. Es la lección de A1.2.
     */
    it('ninguno enlaza la ficha pública (que daría 404)', () => {
      for (const action of TODAS) {
        const { href } = getNotificationContent(conAccion(action));
        expect(href).toBe('/mis-anuncios');
      }
    });

    it('EXPIRED dice que no lo ha retirado nadie («desapareció y no sé por qué»)', () => {
      const { text } = getNotificationContent(conAccion('EXPIRED'));
      expect(text).toContain('No lo ha retirado nadie');
      expect(text).toContain('volver a publicarlo');
    });

    it('EXPIRING_SOON dice cuántos días quedan y para qué sirve renovar antes', () => {
      expect(getNotificationContent(conAccion('EXPIRING_SOON', { daysLeft: 7 })).text).toContain(
        'en 7 días',
      );
      expect(getNotificationContent(conAccion('EXPIRING_SOON', { daysLeft: 7 })).text).toContain(
        'seguirá donde está',
      );
      // Un solo día no se dice «en 1 días».
      expect(getNotificationContent(conAccion('EXPIRING_SOON', { daysLeft: 1 })).text).toContain(
        'mañana',
      );
    });

    it('EDITED_BY_STAFF muestra el motivo (que hoy sólo iba al AuditLog)', () => {
      const { text } = getNotificationContent(
        conAccion('EDITED_BY_STAFF', { reason: 'Precio fuera de rango' }),
      );
      expect(text).toContain('Precio fuera de rango');
      // Y dice que sigue publicado: editar no es retirar.
      expect(text).toContain('Sigue publicado');
    });

    it('sin motivo se lee igual de bien (degradación limpia)', () => {
      for (const action of TODAS) {
        const { text } = getNotificationContent(conAccion(action, { daysLeft: 2 }));
        expect(text).not.toContain('Motivo:');
        expect(text).not.toContain('null');
      }
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
      { ...base, type: 'REVIEW_MODERATED', data: { reviewId: 'r', rating: 3, listingTitle: null, targetName: 'Ana', action: 'RETIRED', reason: null } },
      { ...base, type: 'BUMP_AUTO_PAUSED', data: { scheduleId: 'b', listingId: 'l', listingTitle: 'T', reason: 'NO_FUNDS' } },
      { ...base, type: 'DATA_EXPORT_READY', data: { exportId: 'e', expiresAt: '2026-09-04T10:00:00.000Z', sizeBytes: 1024 } },
      { ...base, type: 'ACCOUNT_MODERATED', data: { action: 'SUSPENDED', reason: null, suspendedUntil: null, newRole: null } },
      { ...base, type: 'LISTING_LIFECYCLE', data: { listingId: 'l', listingTitle: 'T', action: 'EXPIRED', reason: null, daysLeft: null } },
    ];

    for (const n of ejemplares) {
      const { text, href } = getNotificationContent(n);
      expect({ type: n.type, text }).not.toEqual({ type: n.type, text: GENERICO });
      expect(href.startsWith('/')).toBe(true);
    }
  });
});
