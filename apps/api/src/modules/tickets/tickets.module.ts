import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';

/**
 * Atención al usuario — R1 (modelo + máquina de estados) y R2 (API de usuario).
 *
 * `TicketsController` expone SOLO las rutas del usuario, owner-scoped. La API de
 * staff (`/admin/tickets`, `@Roles(MODERATOR, ADMIN)`) llega en R3 como un
 * controlador SEPARADO, no como más métodos de este — mismo reparto que
 * `ContactModule` (público + `AdminContactMessagesController`).
 *
 * PrismaModule y RedisModule (de donde sale RateLimitService) son @Global, así
 * que aquí solo hace falta AuditLogModule.
 */
@Module({
  imports: [AuditLogModule],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
