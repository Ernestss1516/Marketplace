import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE_INDEXING } from '../queue.constants';

@Processor(QUEUE_INDEXING)
export class IndexingProcessor extends WorkerHost {
  async process(_job: Job): Promise<void> {
    // TODO: index or remove ACTIVE listings in Meilisearch
  }
}
