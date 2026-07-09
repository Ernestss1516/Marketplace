import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RedisService } from '../../infra/redis/redis.service';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';

const cacheKey = (slug: string) => `listing:${slug}`;

@Injectable()
export class ListingActivationService {
  constructor(
    private readonly redis: RedisService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
  ) {}

  /** Invalidates the listing's cache entry and enqueues its reindex job.
   * `triggerAlertMatch` rides along on the SAME 'index' job (not a second,
   * parallel job) so IndexingProcessor can chain the matching job only after
   * Meilisearch has confirmed the write — no race between "is this listing
   * searchable yet" and "go check which alerts match it". */
  async reindexListing(
    slug: string,
    listingId: string,
    opts?: { triggerAlertMatch?: boolean },
  ): Promise<void> {
    await this.redis.client.del(cacheKey(slug));
    await this.indexingQueue.add('index', {
      listingId,
      triggerAlertMatch: opts?.triggerAlertMatch ?? false,
    });
  }

  /**
   * Called by every path that transitions a Listing to ACTIVE (publish,
   * approveListing, restoreListing, renew). Single hook point for the
   * alert-matching job (B3) to plug into so it covers all paths by construction.
   */
  async listingBecameActive(slug: string, listingId: string): Promise<void> {
    await this.reindexListing(slug, listingId, { triggerAlertMatch: true });
  }
}
