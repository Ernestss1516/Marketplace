import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { ListingsService } from '../listings/listings.service';
import { CategoryListingsQueryDto } from '../listings/dto/category-listings-query.dto';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly listingsService: ListingsService,
  ) {}

  @Get()
  findTree() {
    return this.categoriesService.findTree();
  }

  @Get(':slug/listings')
  getListings(
    @Param('slug') slug: string,
    @Query() query: CategoryListingsQueryDto,
  ) {
    return this.listingsService.findByCategory(
      slug,
      query.page,
      query.perPage,
      query.sort,
    );
  }

  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.categoriesService.findBySlug(slug);
  }
}
