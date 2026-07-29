import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TicketsService } from './tickets.service';
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
  imports: [AuditLogModule],
  controllers: [TicketsController, AdminTicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
