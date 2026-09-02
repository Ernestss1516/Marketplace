import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BrandingService } from './branding.service';

/**
 * PÚBLICO, SIN GUARDS — el logo se le enseña a todo el mundo, y la cabecera pública se
 * pinta también para quien no ha iniciado sesión. Molde exacto de `GET /footer` y
 * `GET /homepage`: cacheado agresivamente en el frontend (`unstable_cache`, UNA entrada
 * con clave constante, tag `branding`) e invalidado por tag desde `BrandingService` en
 * cuanto un admin cambia un logo.
 *
 * Devuelve las tres zonas, la del backoffice incluida — ver `BrandingService.get()`.
 */
@ApiTags('Marca')
@Controller('branding')
export class BrandingController {
  constructor(private readonly brandingService: BrandingService) {}

  @Get()
  get() {
    return this.brandingService.get();
  }
}
