import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QUEUE_NOTIFICATIONS, retryQueue } from '../../infra/queue/queue.constants';
import { TicketsService } from './tickets.service';
import { TicketNotificationsService } from './ticket-notifications.service';
import { TicketsController } from './tickets.controller';
import { AdminTicketsController } from './admin-tickets.controller';

/**
 * Atención al usuario — R1 (modelo + máquina de estados), R2 (API de usuario) y
 * R3 (API de staff).
 *
 * DOS controladores separados, no uno con rutas mezcladas — mismo reparto que
 * `ContactModule` (público + `AdminContactMessagesController`):
 *   · `TicketsController` (`/tickets`) — owner-scoped, solo el dueño del hilo.
 *   · `AdminTicketsController` (`/admin/tickets`) — `@Roles(MODERATOR, ADMIN)`.
 * Sus payloads difieren en lo esencial (el de staff incluye las notas internas y
 * los datos del usuario); tenerlos en clases distintas es lo que impide servir
 * uno por la puerta del otro.
 *
 * PrismaModule y RedisModule (de donde sale RateLimitService) son @Global, así
 * que aquí solo hace falta AuditLogModule.
 */
@Module({
  imports: [
    AuditLogModule,
    NotificationsModule,
    // R4 — la cola se REGISTRA AQUÍ con `retryQueue`, igual que hacen
    // ContactModule y AlertsModule. No se hereda del módulo central:
    // @nestjs/bullmq crea una Queue (productora) por registro, cada una con sus
    // propios defaultJobOptions, así que un módulo que encole sin pasar por
    // `retryQueue()` se quedaría en attempts:1 en silencio. `queue-retry.e2e-spec.ts`
    // grepea el código y rompe la suite si alguien lo olvida.
    BullModule.registerQueue(retryQueue(QUEUE_NOTIFICATIONS)),
  ],
  controllers: [TicketsController, AdminTicketsController],
  providers: [TicketsService, TicketNotificationsService],
  exports: [TicketsService],
})
export class TicketsModule {}
