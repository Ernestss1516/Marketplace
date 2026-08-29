import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QUEUE_NOTIFICATIONS } from '../../infra/queue/queue.constants';
import {
  NOTIFICATION_JOB,
  type SendListingLifecycleData,
} from '../../infra/queue/notification.types';
import type { ListingLifecycleAction } from '../notifications/notification.types';

/** Las acciones que además van por correo. Ver `SendListingLifecycleData`. */
const CON_CORREO: ReadonlySet<ListingLifecycleAction> = new Set([
  'EXPIRING_SOON',
  'EXPIRED',
  'EDITED_BY_STAFF',
  'DELETED_BY_STAFF',
]);

/** Lo mínimo que hace falta del anuncio. Se pasa YA LEÍDO por el llamante. */
export interface AnuncioDelAviso {
  id: string;
  title: string;
  sellerId: string;
}

/**
 * NOTIFICACIONES N3 — LOS AVISOS DEL CICLO DE VIDA DE UN ANUNCIO.
 *
 * ── EL HUECO QUE CIERRA ─────────────────────────────────────────────────────
 *
 * `LISTING_MODERATED` (§14.5) cubría las decisiones del staff. Lo que no cubría
 * nadie es lo que le pasa al anuncio por el camino, y sobre todo **expirar**: el
 * cron de las 02:00 lo sacaba del marketplace sin que su dueño hubiera hecho nada
 * y sin decirle una palabra. Es el caso «desapareció y no sé por qué» que la
 * auditoría marcó como de más valor de todo §A3.1.
 *
 * ── SERVICIO PROPIO, MISMO REPARTO QUE SIEMPRE ──────────────────────────────
 *
 * El «a quién se le cuenta qué» fuera de quien decide, igual que
 * `ModerationNotificationsService`, `TicketNotificationsService` y
 * `AccountModerationNotificationsService`. Se heredan sus dos invariantes:
 *
 *   1. **El aviso es efecto, nunca causa.** Nada de aquí escribe en `Listing`. Se
 *      invoca DESPUÉS de que el cambio haya persistido.
 *   2. **Snapshot autocontenido**: el título viaja congelado. En
 *      `DELETED_BY_STAFF` no es un formalismo — la fila ya no existe cuando se
 *      pinta el aviso, así que el llamante tiene que leerla ANTES de borrarla.
 *
 * ── LO QUE ESTE SERVICIO NO HACE: AVISAR DE LO QUE HIZO EL DUEÑO ────────────
 *
 * Pausar, despausar, renovar, destacar, editar o archivar por propia mano no
 * llaman aquí, y es el criterio explícito de §A3.1: avisar a alguien de lo que
 * acaba de hacer es ruido, y la interfaz ya se lo confirmó con un toast. Todo lo
 * que entra por esta puerta le pasa al anuncio **sin que su dueño lo pidiera**.
 */
@Injectable()
export class ListingLifecycleNotificationsService {
  private readonly logger = new Logger(ListingLifecycleNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly queue: Queue,
  ) {}

  /**
   * El aviso. In-app siempre; correo sólo en las acciones que lo llevan.
   *
   * `anuncio` va YA LEÍDO y no por id: para `DELETED_BY_STAFF` es obligatorio
   * (después no hay fila), y para el resto ahorra una consulta que el llamante ya
   * ha hecho.
   */
  async ocurrio(
    anuncio: AnuncioDelAviso,
    action: ListingLifecycleAction,
    extra?: { reason?: string | null; daysLeft?: number | null },
  ): Promise<void> {
    const reason = extra?.reason ?? null;
    const daysLeft = extra?.daysLeft ?? null;

    // In-app primero: es el canal que no depende de configuración externa.
    await this.notifications.createNotification(anuncio.sellerId, 'LISTING_LIFECYCLE', {
      listingId: anuncio.id,
      listingTitle: anuncio.title,
      action,
      reason,
      daysLeft,
    });

    if (!CON_CORREO.has(action)) return;

    const seller = await this.prisma.user.findUnique({
      where: { id: anuncio.sellerId },
      select: { email: true, name: true },
    });
    if (!seller) return;

    await this.queue.add(NOTIFICATION_JOB.SEND_LISTING_LIFECYCLE, {
      email: seller.email,
      name: seller.name,
      listingTitle: anuncio.title,
      // El `Set` de arriba garantiza que sólo llegan las cuatro con correo; el
      // `as` es la costura entre esa comprobación en runtime y la unión estrecha
      // de `SendListingLifecycleData`, que existe justamente para que ninguna otra
      // pueda colarse por descuido.
      action: action as SendListingLifecycleData['action'],
      reason,
      daysLeft,
    } satisfies SendListingLifecycleData);

    this.logger.log(`Aviso de ciclo de vida (${action}) enviado para ${anuncio.id}`);
  }
}
