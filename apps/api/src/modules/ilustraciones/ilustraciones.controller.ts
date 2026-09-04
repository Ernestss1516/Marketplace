import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IlustracionesService } from './ilustraciones.service';

/**
 * PÚBLICO, SIN GUARDS — molde exacto de `GET /branding`, `GET /footer` y `GET /homepage`.
 *
 * Las ilustraciones se pintan en pantallas de la cuenta, pero también en la búsqueda sin
 * resultados, que es pública y se sirve sin sesión. Y ninguna es un secreto: son objetos
 * públicos del bucket.
 *
 * Devuelve los DIEZ slots RESUELTOS —url, alt y dimensiones—, no la configuración cruda:
 * el frontend no tiene que saber si lo que recibe es el default del modelo o una
 * sustitución del admin para poder pintarlo. Cacheado agresivamente en el frontend
 * (`unstable_cache`, UNA entrada con clave constante, tag `ilustraciones`) e invalidado
 * por tag desde el servicio en cuanto un admin sustituye una.
 */
@ApiTags('Ilustraciones')
@Controller('ilustraciones')
export class IlustracionesController {
  constructor(private readonly ilustracionesService: IlustracionesService) {}

  @Get()
  get() {
    return this.ilustracionesService.get();
  }
}
