import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_INDEXING } from '../queue.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchService, INDEX_INCLUDE } from '../../../modules/search/search.service';
import { GeocodingService } from '../../../modules/geocoding/geocoding.service';

@Processor(QUEUE_INDEXING)
export class IndexingProcessor extends WorkerHost {
  private readonly logger = new Logger(IndexingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly geocoding: GeocodingService,
  ) {
    super();
  }

  async process(job: Job<{ listingId: string }>): Promise<void> {
    try {
      const { listingId } = job.data;
      switch (job.name) {
        case 'index': {
          const queueWaitMs = Date.now() - job.timestamp;
          this.logger.log(`[TIMING] index start listingId=${listingId} queueWait=${queueWaitMs}ms`);
          const t0 = Date.now();
          await this.handleIndex(listingId);
          this.logger.log(`[TIMING] index done listingId=${listingId} indexTime=${Date.now() - t0}ms totalFromEnqueue=${Date.now() - job.timestamp}ms`);
          return;
        }
        case 'remove':
          return this.handleRemove(listingId);
        case 'geocode': {
          const queueWaitMs = Date.now() - job.timestamp;
          this.logger.log(`[TIMING] geocode start listingId=${listingId} queueWait=${queueWaitMs}ms`);
          const t0 = Date.now();
          await this.handleGeocode(listingId);
          this.logger.log(`[TIMING] geocode done listingId=${listingId} geocodeTime=${Date.now() - t0}ms`);
          return;
        }
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

  private async handleGeocode(listingId: string): Promise<void> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, city: true, province: true, postalCode: true },
    });
    if (!listing?.city || !listing?.province) return;

    const coords = await this.geocoding.geocode(
      listing.city,
      listing.province,
      listing.postalCode ?? undefined,
    );
    if (!coords) {
      // Permanent failure (bad address, no results) — geocode() already threw
      // TransientGeocodingError for anything retriable, so reaching here means
      // this listing simply won't resolve. Visible at warn, not silent debug.
      this.logger.warn(`Geocode job: no result for listing ${listingId} (permanent — not retried)`);
      return;
    }

    await this.prisma.listing.update({
      where: { id: listingId },
      data: { latitude: coords.lat, longitude: coords.lng },
    });

    // Do NOT call handleIndex here. The 'index' job already in the queue
    // (enqueued by publishListing or update) will run next (FIFO) and will
    // re-fetch the listing with the updated coordinates — one single Meilisearch
    // write per publication instead of two.
    this.logger.debug(`Geocode job: listing ${listingId} → ${coords.lat},${coords.lng}`);
  }
}
