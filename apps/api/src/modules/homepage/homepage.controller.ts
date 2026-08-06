import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HomepageService } from './homepage.service';

// Público, sin guards — la portada es pública. Cacheado agresivamente en el
// frontend (unstable_cache, UNA entrada con clave constante, tag
// 'homepage-config'), molde exacto de GET /footer.
@ApiTags('Portada')
@Controller('homepage')
export class HomepageController {
  constructor(private readonly homepageService: HomepageService) {}

  @Get()
  get() {
    return this.homepageService.get();
  }
}
