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
import { ListingDetectionsService } from './detection/listing-detections.service';
import { PhoneDetector } from './detection/detectors/phone.detector';
import { PhoneListDetector } from './detection/detectors/phone-list.detector';
import { WordDetector } from './detection/detectors/word.detector';
import { PreModerationService } from './pre-moderation.service';
import { CategoryTreeModule } from '../categories/category-tree.module';
import { ListingExpiryModule } from '../expiration/listing-expiry.module';

@Module({
  imports: [
    // AJUSTES RÁFAGA A — el lector del plazo de caducidad (`listingExpiryDays`). Módulo HOJA:
    // sólo depende de Prisma, así que importarlo no abre ningún ciclo.
    ListingExpiryModule,
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
    // Los detectores se proveen para que el motor los reciba por DI; NO se exportan. Fuera
    // de aquí sólo se conoce el motor: quien consuma detección no elige detectores.
    WordDetector,
    PhoneDetector,
    PhoneListDetector,
    DetectionEngine,
    ListingDetectionsService,
    PreModerationService,
  ],
  // RÁFAGA A — se exportan LOS DOS, y no es redundante: `DetectionEngine` es detección pura
  // sobre texto (la usa la ficha F1, que sólo quiere una señal y no debe escribir nada), y
  // `ListingDetectionsService` es la pasada que además persiste (la usan publicar y editar).
  // Quien sólo lee no puede escribir sin querer.
  exports: [
    ModerationService,
    DetectionEngine,
    ListingDetectionsService,
    PreModerationService,
  ],
})
export class ModerationModule {}
