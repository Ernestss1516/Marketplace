import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NavService } from './nav.service';
import { PublicNavQueryDto } from './dto/public-nav.dto';

/**
 * Público, sin guards — como GET /footer y GET /banners.
 *
 * A diferencia del footer, este endpoint FILTRA por tipo de página: devuelve el
 * árbol ya podado por el gate recursivo y con el href resuelto server-side, así
 * que el frontend solo mapea. Un array vacío significa que la barra no debe
 * renderizarse en absoluto.
 *
 * El consumidor lo cachea por tipo (unstable_cache, clave ['main-nav',
 * pageType], tag 'main-nav') — ver apps/web/src/lib/api/nav.ts.
 */
@ApiTags('Nav')
@Controller('nav')
export class NavController {
  constructor(private readonly navService: NavService) {}

  @Get()
  listPublicNav(@Query() query: PublicNavQueryDto) {
    return this.navService.listPublicNav(query.pageType);
  }
}
