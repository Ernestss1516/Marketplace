import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FooterService } from './footer.service';

// Público, sin guards — resuelto server-side (href + external ya calculados),
// cacheado agresivamente en el frontend (unstable_cache, tag 'footer-nav').
// Reemplaza el antiguo GET /paginas/footer (que derivaba el footer de Post).
@ApiTags('Footer')
@Controller('footer')
export class FooterController {
  constructor(private readonly footerService: FooterService) {}

  @Get()
  listPublicNav() {
    return this.footerService.listPublicNav();
  }
}
