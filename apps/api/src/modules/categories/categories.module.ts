import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ListingsModule } from '../listings/listings.module';
import { TagsModule } from '../tags/tags.module';

@Module({
  imports: [ListingsModule, TagsModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
