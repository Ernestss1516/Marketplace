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

  /** Invalidates the listing's cache entry and enqueues its reindex job. */
  async reindexListing(slug: string, listingId: string): Promise<void> {
    await this.redis.client.del(cacheKey(slug));
    await this.indexingQueue.add('index', { listingId });
  }

  /**
   * Called by every path that transitions a Listing to ACTIVE (publish,
   * approveListing, restoreListing). Single hook point for the alert-matching
   * job (B3) to plug into so it covers all three paths by construction.
   */
  async listingBecameActive(slug: string, listingId: string): Promise<void> {
    await this.reindexListing(slug, listingId);
  }
}
