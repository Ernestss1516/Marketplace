import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  QUEUE_MESSAGE_DIGEST,
  QUEUE_NOTIFICATIONS,
  retryQueue,
} from '../../infra/queue/queue.constants';
import { MessageNotificationsService } from './message-notifications.service';
import { MessageDigestProcessor } from './message-digest.processor';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { MessagingGateway } from './messaging.gateway';
import { AdminMessagingController } from './admin-messaging.controller';
import { AdminMessagingService } from './admin-messaging.service';

@Module({
  imports: [
    AuthModule, // JwtService + ConfigService (global)
    AuditLogModule, // C2 registra cada apertura de hilo
    // N4b — la notificación viva y el correo agrupado.
    NotificationsModule,
    // Dos colas y no una: la del DIGEST lleva el trabajo DIFERIDO que decide, y la
    // de notificaciones el correo que se manda. Ver `QUEUE_MESSAGE_DIGEST`.
    BullModule.registerQueue(
      retryQueue(QUEUE_MESSAGE_DIGEST),
      retryQueue(QUEUE_NOTIFICATIONS),
    ),
  ],
  // El camino de staff vive en este módulo —es el mismo dominio— pero con
  // controlador y servicio PROPIOS: el lector del usuario marca como leído
  // (`getConversation`) y el del staff no puede escribir nada. Ver la cabecera
  // de `AdminMessagingService`.
  controllers: [MessagingController, AdminMessagingController],
  providers: [
    MessagingService,
    MessagingGateway,
    AdminMessagingService,
    MessageNotificationsService,
    MessageDigestProcessor,
  ],
  // R9 — el gateway se EXPORTA para que `TicketsService` pueda emitir
  // `ticket:message` tras el commit. Es la misma relación que ya tiene
  // `MessagingService` con él dentro de este módulo, con el consumidor fuera.
  exports: [MessagingService, MessagingGateway, MessageNotificationsService],
})
export class MessagingModule {}
