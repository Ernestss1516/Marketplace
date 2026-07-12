import { Injectable } from '@nestjs/common';
import { RateLimitService } from '../../infra/redis/rate-limit.service';
import {
  CONTACT_RATE_LIMIT_GLOBAL_PER_HOUR,
  CONTACT_RATE_LIMIT_IP_PER_HOUR,
  CONTACT_RATE_LIMIT_WINDOW_SECONDS,
} from './contact.constants';

/**
 * Rate limit del formulario de contacto (RC.1) — sobre el `RateLimitService`
 * genérico (Redis INCR+EXPIRE, extraído en RÁFAGA 3 para reutilizarlo en
 * auth). Dos contadores: por IP (5/hora) y global (200/hora). El global es la
 * red de seguridad si el de IP resulta falsificable (ver nota sobre trust
 * proxy en main.ts).
 */
@Injectable()
export class ContactRateLimitService {
  constructor(private readonly rateLimit: RateLimitService) {}

  /** Incrementa AMBOS contadores siempre, incluso si el de IP ya superó el
   * límite — así un ataque distribuido con IPs rotando sigue acumulando en el
   * contador global. */
  async checkAndIncrement(ip: string): Promise<{ limited: boolean; retryAfter: number }> {
    const [ipResult, globalResult] = await Promise.all([
      this.rateLimit.checkAndIncrement(
        `contact:rate:ip:${ip}`,
        CONTACT_RATE_LIMIT_IP_PER_HOUR,
        CONTACT_RATE_LIMIT_WINDOW_SECONDS,
      ),
      this.rateLimit.checkAndIncrement(
        'contact:rate:global',
        CONTACT_RATE_LIMIT_GLOBAL_PER_HOUR,
        CONTACT_RATE_LIMIT_WINDOW_SECONDS,
      ),
    ]);

    return {
      limited: ipResult.limited || globalResult.limited,
      retryAfter: CONTACT_RATE_LIMIT_WINDOW_SECONDS,
    };
  }
}
