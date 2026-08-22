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
// PUNTO 6 · RÁFAGA 0 — `BadWordService` ya no existe: es el detector `WORD` del motor.
// No se ha dejado una fachada con el nombre viejo al lado, porque dos nombres para lo
// mismo es como acaban divergiendo (`listing-status.ts` lo documenta habiéndolo pagado).
import { DetectionEngine } from './detection/detection.engine';
import { WordDetector } from './detection/detectors/word.detector';
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
  providers: [
    ModerationService,
    ModerationNotificationsService,
    // El detector se provee para que el motor lo reciba por DI; NO se exporta. Fuera de
    // aquí sólo se conoce el motor: quien consuma detección no elige detectores.
    WordDetector,
    DetectionEngine,
    PreModerationService,
  ],
  exports: [ModerationService, DetectionEngine, PreModerationService],
})
export class ModerationModule {}
