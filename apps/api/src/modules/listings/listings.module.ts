import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_INDEXING,
  QUEUE_MEDIA_CLEANUP,
  QUEUE_NOTIFICATIONS,
  retryQueue,
} from '../../infra/queue/queue.constants';
import { BillingModule } from '../billing/billing.module';
import { ModerationModule } from '../moderation/moderation.module';
import { ListingActivationModule } from '../listing-activation/listing-activation.module';
import { MessagingModule } from '../messaging/messaging.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ListingLifecycleNotificationsModule } from '../listing-lifecycle-notifications/listing-lifecycle-notifications.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TagsModule } from '../tags/tags.module';
import { CategoryTreeModule } from '../categories/category-tree.module';
import { ListingGateModule } from '../listing-gate/listing-gate.module';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { ListingEditValidationModule } from './listing-edit-validation.module';
import { ListingImagesModule } from './listing-images.module';
import { ListingOwnerActivityService } from './listing-owner-activity.service';

@Module({
  imports: [
    // P3a — las reglas de los campos, compartidas con AdminModule.
    ListingEditValidationModule,
    ListingImagesModule,
    BullModule.registerQueue(retryQueue(QUEUE_INDEXING)),
    // Re-registrado aquí (mismo patrón que ContactModule/AlertsModule para QUEUE_NOTIFICATIONS)
    BullModule.registerQueue(retryQueue(QUEUE_NOTIFICATIONS)),
    // BORRADO B3 — limpieza de R2 al descartar un borrador.
    BullModule.registerQueue(retryQueue(QUEUE_MEDIA_CLEANUP)),
    BillingModule,
    ModerationModule,
    ListingActivationModule,
    MessagingModule,
    NotificationsModule,
    // N3 — el acuse de «tu anuncio está en cola de revisión». Servicio compartido
    // con los crones de expiración y con el backoffice.
    ListingLifecycleNotificationsModule,
    ReviewsModule,
    TagsModule,
    CategoryTreeModule,
    ListingGateModule,
  ],
  controllers: [ListingsController],
  providers: [ListingsService, ListingOwnerActivityService],
  exports: [ListingsService],
})
export class ListingsModule {}
