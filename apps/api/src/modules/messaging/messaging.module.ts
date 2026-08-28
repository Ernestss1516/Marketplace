import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { MessagingGateway } from './messaging.gateway';
import { AdminMessagingController } from './admin-messaging.controller';
import { AdminMessagingService } from './admin-messaging.service';

@Module({
  imports: [AuthModule], // provides JwtService (via JwtModule export) and ConfigService (global)
  // El camino de staff vive en este módulo —es el mismo dominio— pero con
  // controlador y servicio PROPIOS: el lector del usuario marca como leído
  // (`getConversation`) y el del staff no puede escribir nada. Ver la cabecera
  // de `AdminMessagingService`.
  controllers: [MessagingController, AdminMessagingController],
  providers: [MessagingService, MessagingGateway, AdminMessagingService],
  // R9 — el gateway se EXPORTA para que `TicketsService` pueda emitir
  // `ticket:message` tras el commit. Es la misma relación que ya tiene
  // `MessagingService` con él dentro de este módulo, con el consumidor fuera.
  exports: [MessagingService, MessagingGateway],
})
export class MessagingModule {}
