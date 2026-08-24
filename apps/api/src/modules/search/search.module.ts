import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { FilterableAttributesResolver } from './filterable-attributes.resolver';
import { MeilisearchModule } from '../../infra/meilisearch/meilisearch.module';
import { SponsoredAdsModule } from '../sponsored-ads/sponsored-ads.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TagsModule } from '../tags/tags.module';
import { CategoryTreeModule } from '../categories/category-tree.module';
import { ImpressionsModule } from '../impressions/impressions.module';

@Module({
  imports: [
    MeilisearchModule,
    SponsoredAdsModule,
    ReviewsModule,
    TagsModule,
    CategoryTreeModule,
    // A1 — lo importa el módulo de BÚSQUEDA porque quien cuenta es su CONTROLADOR.
    // `SearchService` no lo conoce, y esa ignorancia es lo que garantiza que las
    // alertas (que sí usan el servicio) no generen impresiones.
    ImpressionsModule,
  ],
  controllers: [SearchController],
  providers: [SearchService, FilterableAttributesResolver],
  exports: [SearchService, FilterableAttributesResolver],
})
export class SearchModule {}
