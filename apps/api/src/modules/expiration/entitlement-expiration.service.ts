import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EntitlementType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { ListingLifecycleNotificationsService } from '../listing-lifecycle-notifications/listing-lifecycle-notifications.service';

const cacheKey = (slug: string) => `listing:${slug}`;

// Grace period before a PRO downgrade takes effect (§11.4).
const PRO_GRACE_DAYS = 7;

// Default active listing limits — overridden by Setting table values.
const DEFAULT_FREE_LIMIT = 5;

@Injectable()
export class EntitlementExpirationService {
  private readonly logger = new Logger(EntitlementExpirationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    // N3 — el destacado que se acaba deja de ser mudo.
    private readonly lifecycleNotify: ListingLifecycleNotificationsService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
  ) {}

  // Runs daily at 03:00. Separated from the listing-expiry cron (02:00) so
  // failures in one sweep never block the other.
  @Cron('0 3 * * *')
  async runEntitlementExpiration(): Promise<void> {
    await this.runExpirationSweep();
  }

  /**
   * Public entry point so tests can trigger the sweep directly without
   * waiting for the scheduler. The @Cron decorator is just the trigger.
   */
  async runExpirationSweep(): Promise<void> {
    await Promise.all([
      this.expireFeaturedListings(),
      this.downgradeExpiredPro(),
    ]);
  }

  // ---------------------------------------------------------------------------
  // B.1 — Featured listing expiration
  // ---------------------------------------------------------------------------

  private async expireFeaturedListings(): Promise<void> {
    const now = new Date();
    const today = now.toISOString().slice(0, 10); // YYYY-MM-DD for job-id dedup

    // Only process entitlements not yet revoked, with active listings.
    // revokedAt IS NULL ensures each highlighted listing is processed exactly once.
    const expired = await this.prisma.entitlement.findMany({
      where: {
        type: EntitlementType.FEATURED_LISTING,
        expiresAt: { lte: now },
        revokedAt: null,
        listingId: { not: null },
        listing: { status: 'ACTIVE' },
      },
      // N3 — el anuncio viene con lo que hace falta para avisar a su dueño sin una
      // consulta extra por entitlement.
      select: {
        id: true,
        listingId: true,
        listing: { select: { id: true, title: true, sellerId: true } },
      },
    });

    if (expired.length === 0) return;

    // Mark all as revoked in one batch before enqueueing, so a crash mid-loop
    // does not leave them unrevoked for the next day's sweep.
    await this.prisma.entitlement.updateMany({
      where: { id: { in: expired.map((e) => e.id) } },
      data: { revokedAt: now },
    });

    let processed = 0;
    for (const ent of expired) {
      if (!ent.listingId) continue;
      try {
        // jobId includes the date so BullMQ deduplicates within the same day
        // if runExpirationSweep() is called twice (idempotency guarantee).
        await this.indexingQueue.add(
          'index',
          { listingId: ent.listingId },
          { jobId: `feat-exp-${ent.id}-${today}` },
        );

        /**
         * NOTIFICACIONES N3 — se acabó el destacado que pagó.
         *
         * NO NECESITA MARCA DE IDEMPOTENCIA, a diferencia del preaviso de
         * caducidad: la selección de arriba exige `revokedAt: null` y el
         * `updateMany` de antes del bucle ya los ha revocado todos, así que una
         * segunda pasada no encuentra ninguno. La idempotencia la da el propio
         * modelo, igual que se la da al reindexado el `jobId` con la fecha.
         *
         * Sólo in-app: no se pierde nada que se tuviera, se acaba un plazo que el
         * vendedor eligió al comprarlo. Por correo se parecería a una oferta para
         * volver a comprar, que es justo lo que estos avisos no son.
         */
        if (ent.listing) {
          await this.lifecycleNotify.ocurrio(ent.listing, 'FEATURED_EXPIRED');
        }
        processed++;
      } catch (err) {
        // Log and continue — one failed reindex must not abort the whole sweep.
        this.logger.error(
          `Failed to enqueue reindex for listing ${ent.listingId} (entitlement ${ent.id})`,
          err,
        );
      }
    }

    this.logger.log(
      `Featured expiration: ${processed}/${expired.length} listings enqueued for reindex (boostScore → 0)`,
    );
  }

  // ---------------------------------------------------------------------------
  // B.2 — Pro → Free downgrade after grace period
  // ---------------------------------------------------------------------------

  private async downgradeExpiredPro(): Promise<void> {
    const gracePeriodEnd = new Date(Date.now() - PRO_GRACE_DAYS * 24 * 60 * 60 * 1000);

    // Subscriptions still within the 7-day grace period have expiresAt between
    // gracePeriodEnd and now — they are intentionally excluded by this filter.
    const expiredPros = await this.prisma.entitlement.findMany({
      where: {
        type: EntitlementType.PRO_SUBSCRIPTION,
        expiresAt: { lte: gracePeriodEnd },
      },
      select: { userId: true },
      distinct: ['userId'],
    });

    if (expiredPros.length === 0) return;

    // Read the free limit once for the whole sweep.
    const limitSetting = await this.prisma.setting.findUnique({
      where: { key: 'freeActiveListingLimit' },
    });
    const freeLimit = limitSetting ? Number(limitSetting.value) : DEFAULT_FREE_LIMIT;

    let downgraded = 0;
    for (const { userId } of expiredPros) {
      try {
        const drafted = await this.processProDowngrade(userId, freeLimit);
        downgraded += drafted;
      } catch (err) {
        this.logger.error(`Pro downgrade failed for user ${userId}`, err);
      }
    }

    this.logger.log(
      `Pro downgrade sweep: ${expiredPros.length} user(s) checked, ${downgraded} listing(s) moved to DRAFT`,
    );
  }

  private async processProDowngrade(userId: string, freeLimit: number): Promise<number> {
    const now = new Date();

    // Skip users who have renewed their Pro subscription (still have an active one).
    const activePro = await this.prisma.entitlement.findFirst({
      where: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    });
    if (activePro) return 0;

    // Oldest-first: the newest freeLimit listings stay ACTIVE; the oldest excess go to DRAFT.
    // Fetch slug too so we can purge the Redis cache for each downgraded listing.
    const activeListings = await this.prisma.listing.findMany({
      where: { sellerId: userId, status: 'ACTIVE' },
      select: { id: true, slug: true },
      orderBy: { publishedAt: 'asc' },
    });

    const excess = activeListings.length - freeLimit;
    if (excess <= 0) return 0; // already within limit — idempotent

    const toDraft = activeListings.slice(0, excess);
    const toDraftIds = toDraft.map((l) => l.id);

    await this.prisma.listing.updateMany({
      where: { id: { in: toDraftIds } },
      data: { status: 'DRAFT' },
    });

    // Purge Redis cache and enqueue reindex for each downgraded listing so
    // Meilisearch removes them from the index (status DRAFT → removeListing).
    for (const { id, slug } of toDraft) {
      try {
        await this.redis.client.del(cacheKey(slug));
        await this.indexingQueue.add('index', { listingId: id });
      } catch (err) {
        this.logger.error(`Failed to reindex downgraded listing ${id} (slug: ${slug})`, err);
      }
    }

    this.logger.log(
      `User ${userId}: ${activeListings.length} active → ${toDraft.length} moved to DRAFT (free limit: ${freeLimit})`,
    );

    return toDraft.length;
  }
}
