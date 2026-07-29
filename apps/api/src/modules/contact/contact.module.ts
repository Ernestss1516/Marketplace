import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QUEUE_NOTIFICATIONS, retryQueue } from '../../infra/queue/queue.constants';
import { ContactController } from './contact.controller';
import { AdminContactMessagesController } from './admin-contact-messages.controller';
import { AdminContactReasonsController } from './admin-contact-reasons.controller';
import { ContactService } from './contact.service';
import { ContactReasonsService } from './contact-reasons.service';
import { ContactTimeTrapService } from './contact-time-trap.service';
import { ContactRateLimitService } from './contact-rate-limit.service';

@Module({
  imports: [
    AuditLogModule,
    NotificationsModule,
    // Re-registrado aquí (mismo patrón que AlertsModule para QUEUE_NOTIFICATIONS)
    // así ContactService puede inyectar la cola con retry — no se hereda del
    // módulo central, cada módulo que encola registra su propia Queue con sus
    // propios defaultJobOptions.
    BullModule.registerQueue(retryQueue(QUEUE_NOTIFICATIONS)),
  ],
  controllers: [ContactController, AdminContactMessagesController, AdminContactReasonsController],
  providers: [ContactService, ContactReasonsService, ContactTimeTrapService, ContactRateLimitService],
  // R6 (atención al usuario) — TicketsModule sirve `GET /tickets/topics` desde
  // este mismo servicio: los motivos son una taxonomía única con columna de
  // ámbito (§14.1), no dos tablas gemelas. Solo se exporta el de motivos; el
  // resto del módulo (formulario público, defensas anti-bot) sigue encapsulado.
  exports: [ContactReasonsService],
})
export class ContactModule {}
