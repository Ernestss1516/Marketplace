import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INDEXING, retryQueue } from '../../infra/queue/queue.constants';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ExpirationService } from './expiration.service';
import { EntitlementExpirationService } from './entitlement-expiration.service';
import { SuspensionExpirationService } from './suspension-expiration.service';
import { AccountModerationNotificationsModule } from '../account-moderation-notifications/account-moderation-notifications.module';
import { ListingLifecycleNotificationsModule } from '../listing-lifecycle-notifications/listing-lifecycle-notifications.module';

@Module({
  imports: [
    BullModule.registerQueue(retryQueue(QUEUE_INDEXING)),
    // BORRADO DE CUENTAS C4 — la barrida de suspensiones deja constancia de cada
    // sanción que termina. Es el primer cron de este módulo que audita: los otros
    // dos tocan anuncios y entitlements, no el estado de una persona.
    AuditLogModule,
    // NOTIFICACIONES N2 — la barrida además AVISA. Es el camino mayoritario para
    // recuperar una cuenta suspendida (el plazo se cumple solo), así que dejarlo
    // mudo habría sido dejar callado justo el normal.
    AccountModerationNotificationsModule,
    // N3 — caducar, preavisar y el destacado que se acaba. Los tres crones de este
    // módulo avisan ahora al dueño; el servicio es compartido con listings y admin.
    ListingLifecycleNotificationsModule,
  ],
  providers: [ExpirationService, EntitlementExpirationService, SuspensionExpirationService],
  exports: [ExpirationService, EntitlementExpirationService, SuspensionExpirationService],
})
export class ExpirationModule {}
