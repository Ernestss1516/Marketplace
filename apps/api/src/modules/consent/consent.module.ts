import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { RedisModule } from '../../infra/redis/redis.module';
import { ConsentService } from './consent.service';
import { ConsentConfigService } from './consent-config.service';
import { ConsentController } from './consent.controller';
import { ConsentConfigController } from './consent-config.controller';
import { AdminConsentConfigController } from './admin-consent-config.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { RevalidateModule } from '../../common/revalidate/revalidate.module';

/**
 * COOKIES RÁFAGA 1 — el registro del consentimiento.
 * Ver docs/diseno-consentimiento-cookies.md §2.
 *
 * `RedisModule` por el rate limit del endpoint público (exporta `RateLimitService`).
 */
@Module({
  imports: [PrismaModule, RedisModule, AuditLogModule, RevalidateModule],
  controllers: [ConsentController, ConsentConfigController, AdminConsentConfigController],
  providers: [ConsentService, ConsentConfigService],
})
export class ConsentModule {}
