import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INDEXING, retryQueue } from '../../infra/queue/queue.constants';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ExpirationService } from './expiration.service';
import { EntitlementExpirationService } from './entitlement-expiration.service';
import { SuspensionExpirationService } from './suspension-expiration.service';

@Module({
  imports: [
    BullModule.registerQueue(retryQueue(QUEUE_INDEXING)),
    // BORRADO DE CUENTAS C4 — la barrida de suspensiones deja constancia de cada
    // sanción que termina. Es el primer cron de este módulo que audita: los otros
    // dos tocan anuncios y entitlements, no el estado de una persona.
    AuditLogModule,
  ],
  providers: [ExpirationService, EntitlementExpirationService, SuspensionExpirationService],
  exports: [ExpirationService, EntitlementExpirationService, SuspensionExpirationService],
})
export class ExpirationModule {}
