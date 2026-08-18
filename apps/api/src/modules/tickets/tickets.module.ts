import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContactModule } from '../contact/contact.module';
import { MessagingModule } from '../messaging/messaging.module';
import { QUEUE_NOTIFICATIONS, retryQueue } from '../../infra/queue/queue.constants';
import { TicketsService } from './tickets.service';
import { TicketNotificationsService } from './ticket-notifications.service';
import { TicketAttachmentsService } from './ticket-attachments.service';
import { TicketsScheduleService } from './tickets-schedule.service';
import { TicketsController } from './tickets.controller';
import { AdminTicketsController } from './admin-tickets.controller';

/**
 * Atención al usuario — R1 (modelo + máquina de estados), R2 (API de usuario) y
 * R3 (API de staff).
 *
 * DOS controladores separados, no uno con rutas mezcladas — mismo reparto que
 * `ContactModule` (público + `AdminContactMessagesController`):
 *   · `TicketsController` (`/tickets`) — owner-scoped, solo el dueño del hilo.
 *   · `AdminTicketsController` (`/admin/tickets`) — `@MinRole(MODERATOR)`.
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
    // R6 — `GET /tickets/topics` reutiliza ContactReasonsService: los motivos son
    // UNA sola taxonomía con una columna de ámbito (decisión §14.1), no dos
    // tablas. Importar el módulo entero y no duplicar el servicio es lo que
    // mantiene esa decisión en pie.
    ContactModule,
    // R9 — de aquí sale `MessagingGateway`, que es el dueño de la conexión de
    // sockets de la aplicación (un solo namespace `/ws`, una sola sala `user:<id>`
    // compartida por mensajería y tickets). Sin ciclo: MessagingModule solo
    // importa AuthModule.
    MessagingModule,
    // R4 — la cola se REGISTRA AQUÍ con `retryQueue`, igual que hacen
    // ContactModule y AlertsModule. No se hereda del módulo central:
    // @nestjs/bullmq crea una Queue (productora) por registro, cada una con sus
    // propios defaultJobOptions, así que un módulo que encole sin pasar por
    // `retryQueue()` se quedaría en attempts:1 en silencio. `queue-retry.e2e-spec.ts`
    // grepea el código y rompe la suite si alguien lo olvida.
    BullModule.registerQueue(retryQueue(QUEUE_NOTIFICATIONS)),
  ],
  controllers: [TicketsController, AdminTicketsController],
  // R5 — `TicketAttachmentsService` no necesita importar nada: R2Module es @Global
  // (igual que Prisma y Redis). Y NO se importa MediaModule: los adjuntos de
  // ticket usan R2Service directamente, nunca MediaService — ver el doc-comment
  // del servicio.
  providers: [
    TicketsService,
    TicketNotificationsService,
    TicketsScheduleService,
    TicketAttachmentsService,
  ],
  exports: [TicketsService],
})
export class TicketsModule {}
