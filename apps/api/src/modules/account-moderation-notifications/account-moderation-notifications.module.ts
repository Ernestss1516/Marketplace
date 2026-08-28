import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NOTIFICATIONS, retryQueue } from '../../infra/queue/queue.constants';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccountModerationNotificationsService } from './account-moderation-notifications.service';

/**
 * NOTIFICACIONES N2 — módulo propio, por la MISMA razón que `AccountArchiveModule`
 * y `ListingPauseModule`: el servicio tiene **dos llamantes que no se conocen**.
 *
 *   · `AdminModule` — suspender, levantar, banear, reinstaurar, cambiar el rol y
 *     eliminar.
 *   · `AccountArchiveModule` — archivar desde el backoffice.
 *
 * Y no puede vivir dentro de `AdminModule`, que es donde nació: `AdminModule` ya
 * importa `AccountArchiveModule`, así que la vuelta sería un ciclo. Es exactamente
 * el mismo callejón que sacó de `AdminModule` el pausado de anuncios cuando el ban
 * y el archivado tuvieron que compartirlo — y se resuelve igual, con una sola
 * copia en un módulo neutral en vez de dos que acabarían divergiendo.
 */
@Module({
  imports: [NotificationsModule, BullModule.registerQueue(retryQueue(QUEUE_NOTIFICATIONS))],
  providers: [AccountModerationNotificationsService],
  exports: [AccountModerationNotificationsService],
})
export class AccountModerationNotificationsModule {}
