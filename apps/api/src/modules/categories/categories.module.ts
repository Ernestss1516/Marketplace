import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ListingsModule } from '../listings/listings.module';
import { TagsModule } from '../tags/tags.module';
import { CategoryTreeModule } from './category-tree.module';

@Module({
  imports: [ListingsModule, TagsModule, CategoryTreeModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
