import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { RedisModule } from '../../infra/redis/redis.module';
import { ConsentService } from './consent.service';
import { ConsentController } from './consent.controller';

/**
 * COOKIES RÁFAGA 1 — el registro del consentimiento.
 * Ver docs/diseno-consentimiento-cookies.md §2.
 *
 * `RedisModule` por el rate limit del endpoint público (exporta `RateLimitService`).
 */
@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [ConsentController],
  providers: [ConsentService],
})
export class ConsentModule {}
