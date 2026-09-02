import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
import { MeilisearchModule } from './infra/meilisearch/meilisearch.module';
import { QueueModule } from './infra/queue/queue.module';
import { R2Module } from './infra/r2/r2.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ListingsModule } from './modules/listings/listings.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { SearchModule } from './modules/search/search.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { MediaModule } from './modules/media/media.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { ExpirationModule } from './modules/expiration/expiration.module';
import { DataExportModule } from './modules/data-export/data-export.module';
import { BlogModule } from './modules/blog/blog.module';
import { FooterModule } from './modules/footer/footer.module';
import { NavModule } from './modules/nav/nav.module';
import { HomepageModule } from './modules/homepage/homepage.module';
import { BrandingModule } from './modules/branding/branding.module';
import { BillingModule } from './modules/billing/billing.module';
import { RedsysModule } from './modules/redsys/redsys.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { BannersModule } from './modules/banners/banners.module';
import { SponsoredAdsModule } from './modules/sponsored-ads/sponsored-ads.module';
import { ContactModule } from './modules/contact/contact.module';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { BumpScheduleModule } from './modules/bump-schedule/bump-schedule.module';
import { VideoModule } from './modules/video/video.module';
import { BlockMediaModule } from './modules/block-media/block-media.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { TagsModule } from './modules/tags/tags.module';
import { ImpressionsModule } from './modules/impressions/impressions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      // Load env-specific file first (.env.test, .env.production…), then .env as
      // fallback for any vars not defined in the specific file.
      // dotenv never overrides vars already in process.env, so CI-injected vars
      // (DATABASE_URL=marketplace_test etc.) always win over file values.
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
    }),
    // Structured JSON logging via pino. pino-pretty only in development so the
    // worker thread it spawns does not interfere with test runners.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'test' ? 'error' : 'info',
        transport: process.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty' }
          : undefined,
      },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    MeilisearchModule,
    QueueModule,
    R2Module,
    // Domain modules
    AuthModule,
    UsersModule,
    ListingsModule,
    CategoriesModule,
    SearchModule,
    MessagingModule,
    FavoritesModule,
    NotificationsModule,
    AlertsModule,
    ReviewsModule,
    MediaModule,
    ModerationModule,
    AdminModule,
    AuditLogModule,
    ExpirationModule,
    // BORRADO DE CUENTAS C6 — `UsersModule` y `AdminModule` ya lo importan, pero
    // se declara aquí también para que su CRON de caducidad y su controlador de
    // descarga no dependan de que un tercero siga importándolo. Nest deduplica.
    DataExportModule,
    BlogModule,
    FooterModule,
    NavModule,
    HomepageModule,
    BrandingModule,
    BillingModule,
    RedsysModule,
    CampaignsModule,
    CouponsModule,
    BannersModule,
    SponsoredAdsModule,
    ContactModule,
    InvoicingModule,
    BumpScheduleModule,
    VideoModule,
    BlockMediaModule,
    TicketsModule,
    TagsModule,
    // A1 — SearchModule ya lo importa (es su controlador quien cuenta). Se registra
    // también aquí para que el `@Cron` del volcado exista aunque un día la búsqueda
    // deje de ser su único productor.
    ImpressionsModule,
  ],
})
export class AppModule {}
