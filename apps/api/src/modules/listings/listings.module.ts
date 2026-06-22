import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_INDEXING }), GeocodingModule],
  controllers: [ListingsController],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
