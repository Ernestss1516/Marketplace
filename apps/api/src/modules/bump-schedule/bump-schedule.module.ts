import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_BUMP_AUTO,
  QUEUE_NOTIFICATIONS,
  retryQueue,
} from '../../infra/queue/queue.constants';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BumpScheduleService } from './bump-schedule.service';
import { BumpAutoProcessor } from './bump-auto.processor';
import { BumpAutoNotificationsService } from './bump-auto-notifications.service';

/**
 * Bump automático — el MOTOR (ráfaga 3): el cron que reclama turnos y el processor que los
 * ejecuta. La API de usuario (crear, editar, pausar una programación) y la UI llegan en la
 * ráfaga siguiente; por eso aquí todavía no hay controlador.
 *
 * `retryQueue()` y no `{ name }` a mano: hay un test de estructura
 * (`queue-retry.e2e-spec.ts`) que rastrea src/ y rompe la suite si alguien registra una cola
 * saltándose el helper, precisamente para que una cola nueva no acabe con attempts:1 por
 * despiste.
 *
 * PrismaModule es @Global, así que solo hacen falta BillingModule (el cobro, que NO se
 * replica) y NotificationsModule (el canal in-app).
 */
@Module({
  imports: [
    BullModule.registerQueue(retryQueue(QUEUE_BUMP_AUTO)),
    // El aviso por email del bump pausado viaja por la cola de notificaciones existente.
    BullModule.registerQueue(retryQueue(QUEUE_NOTIFICATIONS)),
    BillingModule,
    NotificationsModule,
  ],
  providers: [BumpScheduleService, BumpAutoProcessor, BumpAutoNotificationsService],
  exports: [BumpScheduleService],
})
export class BumpScheduleModule {}
