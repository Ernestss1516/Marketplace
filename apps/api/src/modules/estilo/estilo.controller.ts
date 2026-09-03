import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EstiloService } from './estilo.service';

/**
 * PÚBLICO, SIN GUARDS — molde exacto de `GET /branding`, y por el mismo motivo: el
 * tema se le sirve a todo el mundo, incluida la primera visita anónima. De hecho
 * TIENE que ser público: el layout raíz lo resuelve para pintar el `<style>` de la
 * primera respuesta, y ahí todavía no hay sesión.
 *
 * NO EXPONE NADA SENSIBLE: son los colores que cualquiera ve en la pantalla.
 *
 * Cacheado agresivamente en el frontend (`unstable_cache`, UNA entrada con clave
 * constante, tag `estilo`) e invalidado por tag desde `EstiloService` en cuanto un
 * admin cambia la configuración.
 */
@ApiTags('Estilo')
@Controller('estilo')
export class EstiloController {
  constructor(private readonly estiloService: EstiloService) {}

  @Get()
  get() {
    return this.estiloService.get();
  }
}
