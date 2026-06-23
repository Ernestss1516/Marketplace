import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_INDEXING } from '../queue.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchService, INDEX_INCLUDE } from '../../../modules/search/search.service';

@Processor(QUEUE_INDEXING)
export class IndexingProcessor extends WorkerHost {
  private readonly logger = new Logger(IndexingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
  ) {
    super();
  }

  async process(job: Job<{ listingId: string }>): Promise<void> {
    try {
      const { listingId } = job.data;
      switch (job.name) {
        case 'index':
          return this.handleIndex(listingId);
        case 'remove':
          return this.handleRemove(listingId);
        default:
          this.logger.warn(`Unknown indexing job: ${job.name}`);
      }
    } catch (err) {
      Sentry.captureException(err);
      throw err;
    }
  }

  /**
   * Re-fetches the listing fresh from Postgres before indexing because the
   * listing may have changed between when the job was enqueued and now.
   * SearchService.indexListing() handles the ACTIVE/non-ACTIVE logic.
   */
  private async handleIndex(listingId: string): Promise<void> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: INDEX_INCLUDE,
    });

    if (!listing) {
      // Deleted between enqueue and processing — clean up the index.
      await this.search.removeListing(listingId);
      this.logger.debug(`Listing ${listingId} not found in DB; removed from index.`);
      return;
    }

    await this.search.indexListing(listing);
    this.logger.debug(`Listing ${listingId} processed (status: ${listing.status}).`);
  }

  private async handleRemove(listingId: string): Promise<void> {
    await this.search.removeListing(listingId);
    this.logger.debug(`Listing ${listingId} removed from index.`);
  }
}
