import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

export interface RateLimitResult {
  limited: boolean;
  retryAfter: number;
}

/**
 * Generic Redis (INCR+EXPIRE) rate limiter — extracted from the contact-form
 * limiter (RC.1) so any feature can apply the same IP/key-based windowed
 * counter without reimplementing it. Callers own their key namespace, limit
 * and window; this service only does the counting.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async checkAndIncrement(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const count = await this.incrementWithExpiry(key, windowSeconds);
    return { limited: count > limit, retryAfter: windowSeconds };
  }

  private async incrementWithExpiry(key: string, windowSeconds: number): Promise<number> {
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, windowSeconds);
    return count;
  }
}
