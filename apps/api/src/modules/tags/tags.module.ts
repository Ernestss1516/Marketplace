import { Module } from '@nestjs/common';
import { TagsService } from './tags.service';
import { AdminCategoryTagsController, AdminTagsController } from './admin-tags.controller';
import { TagsController } from './tags.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { MeilisearchModule } from '../../infra/meilisearch/meilisearch.module';

/**
 * B1 — sistema de tags. Los endpoints PÚBLICOS de tags viven en `CategoriesController`
 * (`GET /categories/:slug/tags`) porque cuelgan de una categoría, igual que
 * `/categories/:slug/listings`: no tiene sentido un `/tags/:categorySlug` paralelo. Aquí
 * quedan el servicio y los controladores de administración.
 */
@Module({
  imports: [AuditLogModule, MeilisearchModule],
  controllers: [TagsController, AdminTagsController, AdminCategoryTagsController],
  providers: [TagsService],
  exports: [TagsService],
})
export class TagsModule {}
