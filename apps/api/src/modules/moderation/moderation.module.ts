import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_INDEXING,
  QUEUE_NOTIFICATIONS,
  retryQueue,
} from '../../infra/queue/queue.constants';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ListingActivationModule } from '../listing-activation/listing-activation.module';
import { ListingGateModule } from '../listing-gate/listing-gate.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { ModerationNotificationsService } from './moderation-notifications.service';
import { BadWordService } from './bad-word.service';
import { PreModerationService } from './pre-moderation.service';
import { CategoryTreeModule } from '../categories/category-tree.module';

@Module({
  imports: [
    BullModule.registerQueue(retryQueue(QUEUE_INDEXING)),
    // §14.5 — avisos de moderación. La cola se registra AQUÍ con `retryQueue`,
    // como en ContactModule/TicketsModule: cada módulo que encola crea su propia
    // instancia de Queue, y una que no pase por el helper se queda en attempts:1
    // en silencio (`queue-retry.e2e-spec.ts` grepea el código y lo detecta).
    BullModule.registerQueue(retryQueue(QUEUE_NOTIFICATIONS)),
    AuditLogModule,
    ListingActivationModule,
    ListingGateModule,
    // M1 — el disparador necesita la CADENA de categorías para el pliegue
    // monótono. `CategoryTreeModule` es hoja: importarlo no crea ciclo.
    CategoryTreeModule,
    NotificationsModule,
  ],
  controllers: [ModerationController],
  providers: [ModerationService, ModerationNotificationsService, BadWordService, PreModerationService],
  exports: [ModerationService, BadWordService, PreModerationService],
})
export class ModerationModule {}
