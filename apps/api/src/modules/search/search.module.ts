import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { FilterableAttributesResolver } from './filterable-attributes.resolver';
import { MeilisearchModule } from '../../infra/meilisearch/meilisearch.module';
import { SponsoredAdsModule } from '../sponsored-ads/sponsored-ads.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TagsModule } from '../tags/tags.module';

@Module({
  imports: [MeilisearchModule, SponsoredAdsModule, ReviewsModule, TagsModule],
  controllers: [SearchController],
  providers: [SearchService, FilterableAttributesResolver],
  exports: [SearchService, FilterableAttributesResolver],
})
export class SearchModule {}
