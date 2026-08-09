import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INDEXING, retryQueue } from '../../infra/queue/queue.constants';
import { BillingModule } from '../billing/billing.module';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';

/**
 * Vídeo Pro — infraestructura (ráfaga 1): subida prefirmada, límites y modelo.
 *
 * Módulo propio y no dentro de `media`: `MediaModule` es el camino de IMÁGENES, con su
 * `memoryStorage` y su cola de miniaturas, y ese camino no se toca. El vídeo es otro tipo de
 * media con otro mecanismo de subida —los bytes ni siquiera entran aquí— y mezclarlos haría
 * que un cambio en uno pudiera romper el otro.
 *
 * `PrismaModule`, `RedisModule` y `R2Module` son @Global; solo hace falta `BillingModule`
 * por `EntitlementService`, que es quien sabe si un usuario es Pro.
 */
@Module({
  imports: [BillingModule, BullModule.registerQueue(retryQueue(QUEUE_INDEXING))],
  controllers: [VideoController],
  providers: [VideoService],
  exports: [VideoService],
})
export class VideoModule {}
