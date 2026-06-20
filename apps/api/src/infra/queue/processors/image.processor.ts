import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE_IMAGE } from '../queue.constants';

@Processor(QUEUE_IMAGE)
export class ImageProcessor extends WorkerHost {
  async process(_job: Job): Promise<void> {
    // TODO: resize, convert and upload images to S3/R2
  }
}
