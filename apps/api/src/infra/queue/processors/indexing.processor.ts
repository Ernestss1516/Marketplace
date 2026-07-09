import * as Sentry from '@sentry/nestjs';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { INDEXING_CONCURRENCY, QUEUE_ALERT_MATCHING, QUEUE_INDEXING } from '../queue.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchService, INDEX_INCLUDE } from '../../../modules/search/search.service';
import { GeocodingService } from '../../../modules/geocoding/geocoding.service';

@Processor(QUEUE_INDEXING, { concurrency: INDEXING_CONCURRENCY })
export class IndexingProcessor extends WorkerHost {
  private readonly logger = new Logger(IndexingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly geocoding: GeocodingService,
    @InjectQueue(QUEUE_ALERT_MATCHING) private readonly matchingQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ listingId?: string; triggerAlertMatch?: boolean }>): Promise<void> {
    try {
      switch (job.name) {
        case 'index': {
          const listingId = job.data.listingId!;
          const queueWaitMs = Date.now() - job.timestamp;
          this.logger.log(`[TIMING] index start listingId=${listingId} queueWait=${queueWaitMs}ms`);
          const t0 = Date.now();
          const status = await this.handleIndex(listingId);
          this.logger.log(`[TIMING] index done listingId=${listingId} indexTime=${Date.now() - t0}ms totalFromEnqueue=${Date.now() - job.timestamp}ms`);

          // Chained, not enqueued in parallel: only after indexListing() has
          // confirmed (waitForTask) the document is queryable in Meilisearch,
          // and only when the listing actually IS ACTIVE right now (status
          // read fresh above — it may have changed again since the job was
          // enqueued). Otherwise a race would let Fase 2 (B3) search for a
          // listing Meili hasn't indexed yet, or match one that already left ACTIVE.
          if (job.data.triggerAlertMatch && status === 'ACTIVE') {
            await this.matchingQueue.add('match-alerts', { listingId });
          }
          return;
        }
        case 'remove':
          return this.handleRemove(job.data.listingId!);
        case 'geocode': {
          const listingId = job.data.listingId!;
          const queueWaitMs = Date.now() - job.timestamp;
          this.logger.log(`[TIMING] geocode start listingId=${listingId} queueWait=${queueWaitMs}ms`);
          const t0 = Date.now();
          await this.handleGeocode(listingId);
          this.logger.log(`[TIMING] geocode done listingId=${listingId} geocodeTime=${Date.now() - t0}ms`);
          return;
        }
        // RÁFAGA 2 (admin de categorías) — refresco en caliente tras editar
        // attributeSchema. Sin listingId; encolado desde AdminService.
        case 'refresh-filterable-attributes':
          return this.search.refreshFilterableAttributes();
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
   * Returns the freshly-read status (or null if the listing is gone) so the
   * 'index' case above can decide whether to chain the alert-matching job.
   */
  private async handleIndex(listingId: string): Promise<string | null> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: INDEX_INCLUDE,
    });

    if (!listing) {
      // Deleted between enqueue and processing — clean up the index.
      await this.search.removeListing(listingId);
      this.logger.debug(`Listing ${listingId} not found in DB; removed from index.`);
      return null;
    }

    await this.search.indexListing(listing);
    this.logger.debug(`Listing ${listingId} processed (status: ${listing.status}).`);
    return listing.status;
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
      // Still reindex: the caller (update()) may have changed other fields
      // (price, title, attributes...) that must reach Meilisearch even when
      // the address itself never resolves.
      await this.handleIndex(listingId);
      return;
    }

    await this.prisma.listing.update({
      where: { id: listingId },
      data: { latitude: coords.lat, longitude: coords.lng },
    });

    // Reindex here, in the same job, right after the coordinate write —
    // instead of relying on a separately queued 'index' job to run afterwards
    // (which only held true under concurrency=1 / strict FIFO; see queue.module.ts
    // comment history). update() no longer enqueues a second 'index' job for this
    // case, so there is nothing left to race against, at any concurrency.
    await this.handleIndex(listingId);
    this.logger.debug(`Geocode job: listing ${listingId} → ${coords.lat},${coords.lng}`);
  }
}
