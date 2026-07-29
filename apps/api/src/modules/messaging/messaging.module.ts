import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { MessagingGateway } from './messaging.gateway';

@Module({
  imports: [AuthModule], // provides JwtService (via JwtModule export) and ConfigService (global)
  controllers: [MessagingController],
  providers: [MessagingService, MessagingGateway],
  // R9 — el gateway se EXPORTA para que `TicketsService` pueda emitir
  // `ticket:message` tras el commit. Es la misma relación que ya tiene
  // `MessagingService` con él dentro de este módulo, con el consumidor fuera.
  exports: [MessagingService, MessagingGateway],
})
export class MessagingModule {}
