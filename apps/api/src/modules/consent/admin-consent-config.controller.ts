import { Body, Controller, Get, Ip, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, MinRole } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { ConsentConfigService, type CookieTextConfig } from './consent-config.service';
import { UpdateCookieConfigDto } from './dto/update-cookie-config.dto';

/**
 * COOKIES RÁFAGA 2 — el texto del banner, desde el backoffice.
 *
 * **ADMIN, no EDITOR**, y es el argumento ya escrito en `AdminBrandingController`: que el
 * rol de editar coincida con el rol de lo que se edita. El blog admite EDITOR porque es
 * contenido; esto es un texto legal que sale en todas las páginas de la instancia.
 *
 * DOS VERBOS Y NINGUNO MÁS. No hay `DELETE`: no existe «quitar el banner». Vaciar un
 * texto lo devuelve a su defecto, nunca a la nada — el servicio lo garantiza. Es la
 * frontera hecha ruta: desde aquí no se puede apagar el consentimiento, sólo cambiar
 * cómo se cuenta.
 */
@ApiTags('Admin Cookies')
@ApiBearerAuth('access-token')
@Controller('admin/cookies-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.ADMIN)
export class AdminConsentConfigController {
  constructor(private readonly configService: ConsentConfigService) {}

  /**
   * Lo que se está sirviendo AHORA, sin pasar por ninguna caché.
   *
   * Molde de `getBrandingLive`: quien va a cambiar un texto tiene que ver el que hay, no
   * el que la caché del sitio público sirva durante la hora siguiente.
   */
  @Get()
  get(): Promise<CookieTextConfig> {
    return this.configService.get();
  }

  @Put()
  update(
    @Body() dto: UpdateCookieConfigDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<CookieTextConfig> {
    return this.configService.update(dto, user.userId, ip);
  }
}
