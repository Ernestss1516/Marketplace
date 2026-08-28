import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NOTIFICATIONS, retryQueue } from '../../infra/queue/queue.constants';
import { NotificationsModule } from '../notifications/notifications.module';
import { ListingLifecycleNotificationsService } from './listing-lifecycle-notifications.service';

/**
 * NOTIFICACIONES N3 — módulo propio, por la misma razón que
 * `AccountModerationNotificationsModule` en N2: el servicio tiene **cuatro
 * llamantes que no se conocen entre sí**.
 *
 *   · `ListingsModule`   — publicar (entra en cola de revisión).
 *   · `ExpirationModule` — el cron que caduca anuncios, y el que preavisa.
 *   · `ExpirationModule` — el cron de entitlements (destacado caducado).
 *   · `AdminModule`      — editar y eliminar desde el backoffice.
 *
 * Vivir dentro de cualquiera de ellos obligaría a los otros tres a importarlo, y
 * `AdminModule` no importa `ListingsModule` a propósito («arrastraría medio
 * dominio»). Un módulo neutral es la única forma de que haya UNA copia.
 */
@Module({
  imports: [NotificationsModule, BullModule.registerQueue(retryQueue(QUEUE_NOTIFICATIONS))],
  providers: [ListingLifecycleNotificationsService],
  exports: [ListingLifecycleNotificationsService],
})
export class ListingLifecycleNotificationsModule {}
