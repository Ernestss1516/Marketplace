import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { ListingsService } from '../listings/listings.service';
import { TagsService } from '../tags/tags.service';
import { CategoryListingsQueryDto } from '../listings/dto/category-listings-query.dto';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly listingsService: ListingsService,
    private readonly tagsService: TagsService,
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

  /**
   * B1 — tags EFECTIVOS de la categoría (propios + heredados del padre, solo activos,
   * los propios primero). Cuelga de la categoría igual que `/listings` porque es una
   * propiedad suya, no un recurso aparte.
   *
   * `GET /categories/:slug` ya los incluye para que el wizard no necesite dos viajes;
   * este endpoint existe para quien solo quiere los tags: el panel de filtros (B3) y el
   * buscador de portada (B4).
   */
  @Get(':slug/tags')
  getTags(@Param('slug') slug: string) {
    return this.tagsService.effectiveTagsForCategory(slug);
  }

  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.categoriesService.findBySlug(slug);
  }
}
