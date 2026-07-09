import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_ALERT_MATCHING } from '../queue.constants';
import { AlertMatchingService } from '../../../modules/alerts/alert-matching.service';

@Processor(QUEUE_ALERT_MATCHING)
export class AlertMatchingProcessor extends WorkerHost {
  private readonly logger = new Logger(AlertMatchingProcessor.name);

  constructor(private readonly alertMatching: AlertMatchingService) {
    super();
  }

  async process(job: Job<{ listingId: string }>): Promise<void> {
    try {
      switch (job.name) {
        case 'match-alerts':
          return this.alertMatching.matchListing(job.data.listingId);
        default:
          this.logger.warn(`Unknown alert-matching job: ${job.name}`);
      }
    } catch (err) {
      Sentry.captureException(err);
      throw err;
    }
  }
}
