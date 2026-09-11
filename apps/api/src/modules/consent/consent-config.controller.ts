import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConsentConfigService, type CookieTextConfig } from './consent-config.service';

/**
 * COOKIES RÁFAGA 2 — el texto del banner, para el sitio público.
 *
 * PÚBLICO Y SIN GUARDS, molde exacto de `GET /branding` (`branding.controller.ts:15`) y
 * `GET /estilo` (`estilo.controller.ts:18`): es el texto que se le enseña a cualquiera
 * que entre, así que pedir credenciales para leerlo no tendría sentido.
 *
 * NUNCA 404 NI 500 POR FALTA DE DATOS: sin filas devuelve los valores por defecto. Es la
 * misma doctrina de «degrada, nunca rompe» que la marca y el tema — y aquí pesa más,
 * porque lo que degradaría es el banner legal.
 */
@ApiTags('Cookies')
@Controller('cookies')
export class ConsentConfigController {
  constructor(private readonly configService: ConsentConfigService) {}

  @Get('config')
  get(): Promise<CookieTextConfig> {
    return this.configService.get();
  }
}
