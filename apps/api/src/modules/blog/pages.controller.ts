import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BlogService } from './blog.service';
import { ListPublicPostsDto } from './dto/list-public-posts.dto';

// Público, sin guards — mismo patrón que BlogController, pero type=PAGE
// (páginas informativas: términos, privacidad...). GET / solo lo consume el
// sitemap (no hay UI que liste páginas; se enlazan manualmente, p.ej. desde el
// footer).
@ApiTags('Pages')
@Controller('paginas')
export class PagesController {
  constructor(private readonly blogService: BlogService) {}

  @Get()
  listPublished(@Query() dto: ListPublicPostsDto) {
    return this.blogService.listPublishedPages(dto);
  }

  // IMPORTANTE: esta ruta estática debe declararse ANTES de @Get(':slug') — si
  // no, Nest la trataría como findBySlug('footer') y este endpoint nunca se
  // alcanzaría (mismo gotcha ya documentado en AdminController para
  // categories/searchable-keys y categories/reorder).
  @Get('footer')
  listFooter() {
    return this.blogService.listFooterPages();
  }

  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.blogService.findPageBySlug(slug);
  }
}
