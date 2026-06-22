import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';

const EXPIRY_DAYS = 60;
const cacheKey = (slug: string) => `listing:${slug}`;

@Injectable()
export class ExpirationService {
  private readonly logger = new Logger(ExpirationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
  ) {}

  // Runs daily at 02:00. RESERVED listings are intentionally excluded: a
  // reserved listing is in active negotiation and must not expire automatically.
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async expireListings(): Promise<void> {
    const now = new Date();

    const expired = await this.prisma.listing.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      select: { id: true, slug: true },
    });

    if (expired.length === 0) return;

    await this.prisma.listing.updateMany({
      where: { id: { in: expired.map((l) => l.id) } },
      data: { status: 'EXPIRED' },
    });

    await Promise.all(
      expired.map(async ({ id, slug }) => {
        await this.redis.client.del(cacheKey(slug));
        await this.indexingQueue.add('index', { listingId: id });
      }),
    );

    this.logger.log(`Expired ${expired.length} listing(s).`);
  }

  static expiresAt(from: Date): Date {
    return new Date(from.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  }
}
