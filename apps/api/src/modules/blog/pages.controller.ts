import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BlogService } from './blog.service';
import { ListPublicPostsDto } from './dto/list-public-posts.dto';

// Público, sin guards — mismo patrón que BlogController, pero type=PAGE
// (páginas informativas: términos, privacidad...). GET / solo lo consume el
// sitemap (no hay UI que liste páginas; se enlazan manualmente, p.ej. desde el
// footer). El endpoint del footer ya no vive aquí — ver GET /footer en
// FooterController (modules/footer): el footer dejó de derivarse de Post.
@ApiTags('Pages')
@Controller('paginas')
export class PagesController {
  constructor(private readonly blogService: BlogService) {}

  @Get()
  listPublished(@Query() dto: ListPublicPostsDto) {
    return this.blogService.listPublishedPages(dto);
  }

  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.blogService.findPageBySlug(slug);
  }
}
