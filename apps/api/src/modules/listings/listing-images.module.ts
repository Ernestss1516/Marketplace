import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_MEDIA_CLEANUP, retryQueue } from '../../infra/queue/queue.constants';
import { ListingGateModule } from '../listing-gate/listing-gate.module';
import { ListingImagesService } from './listing-images.service';

/**
 * 2b — MÓDULO NEUTRAL para las fotos de un anuncio.
 *
 * Existe por el mismo motivo, y con el mismo molde, que `ListingEditValidationModule`
 * (P3a): lo necesitan DOS módulos que no pueden verse entre sí. `ListingsModule` tiene el
 * camino del dueño y `AdminModule` el del staff, y `AdminModule` **no importa
 * ListingsModule** — hacerle importarlo arrastraría billing, mensajería, moderación y
 * notificaciones para usar una función.
 *
 * Sus dependencias son ligeras y ya las tienen los dos: `ListingGateModule` es HOJA (de
 * ahí sale `PhotoLimitsService`, el único lector de los topes de fotos) y la cola de
 * limpieza de B3. `PrismaModule` y `R2Module` son `@Global`.
 */
@Module({
  imports: [ListingGateModule, BullModule.registerQueue(retryQueue(QUEUE_MEDIA_CLEANUP))],
  providers: [ListingImagesService],
  exports: [ListingImagesService],
})
export class ListingImagesModule {}
