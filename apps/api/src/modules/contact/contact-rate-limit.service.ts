import { Injectable } from '@nestjs/common';
import { RedisService } from '../../infra/redis/redis.service';
import {
  CONTACT_RATE_LIMIT_GLOBAL_PER_HOUR,
  CONTACT_RATE_LIMIT_IP_PER_HOUR,
  CONTACT_RATE_LIMIT_WINDOW_SECONDS,
} from './contact.constants';

/**
 * Rate limit del formulario de contacto (RC.1) — Redis puro (INCR+EXPIRE), sin
 * dependencia nueva, reutilizando el cliente que ya usa BullMQ. Dos contadores:
 * por IP (5/hora) y global (200/hora). El global es la red de seguridad si el
 * de IP resulta falsificable (ver nota sobre trust proxy en main.ts).
 */
@Injectable()
export class ContactRateLimitService {
  constructor(private readonly redis: RedisService) {}

  /** Incrementa AMBOS contadores siempre, incluso si el de IP ya superó el
   * límite — así un ataque distribuido con IPs rotando sigue acumulando en el
   * contador global. */
  async checkAndIncrement(ip: string): Promise<{ limited: boolean; retryAfter: number }> {
    const [ipCount, globalCount] = await Promise.all([
      this.incrementWithExpiry(`contact:rate:ip:${ip}`),
      this.incrementWithExpiry('contact:rate:global'),
    ]);

    const limited =
      ipCount > CONTACT_RATE_LIMIT_IP_PER_HOUR || globalCount > CONTACT_RATE_LIMIT_GLOBAL_PER_HOUR;

    return { limited, retryAfter: CONTACT_RATE_LIMIT_WINDOW_SECONDS };
  }

  private async incrementWithExpiry(key: string): Promise<number> {
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, CONTACT_RATE_LIMIT_WINDOW_SECONDS);
    return count;
  }
}
