import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QUEUE_NOTIFICATIONS, RETRY_JOB_OPTIONS } from '../../infra/queue/queue.constants';
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
    // así ContactService puede inyectar la cola con RETRY_JOB_OPTIONS — no se
    // hereda del módulo central, cada módulo que encola registra su propia
    // Queue con sus propios defaultJobOptions.
    BullModule.registerQueue({ name: QUEUE_NOTIFICATIONS, defaultJobOptions: RETRY_JOB_OPTIONS }),
  ],
  controllers: [ContactController, AdminContactMessagesController, AdminContactReasonsController],
  providers: [ContactService, ContactReasonsService, ContactTimeTrapService, ContactRateLimitService],
})
export class ContactModule {}
