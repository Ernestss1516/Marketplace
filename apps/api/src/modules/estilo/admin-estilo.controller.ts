import { Body, Controller, Delete, Get, Ip, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, MinRole } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { EstiloService } from './estilo.service';
import { SetEstiloDto } from './dto/set-estilo.dto';

/**
 * ADMIN, no EDITOR — mismo argumento que la marca (`AdminBrandingController`): el
 * blog admite EDITOR porque es contenido, pero el aspecto de la plataforma es
 * configuración de instancia, y lo que se guarda aquí repinta las 81 pantallas.
 */
@ApiTags('Admin Estilo')
@ApiBearerAuth('access-token')
@Controller('admin/estilo')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.ADMIN)
export class AdminEstiloController {
  constructor(private readonly estiloService: EstiloService) {}

  /** El catálogo de modelos + la configuración actual: lo que la pantalla necesita. */
  @Get()
  async get() {
    const [config, resuelto] = await Promise.all([
      this.estiloService.getConfig(),
      this.estiloService.get(),
    ]);
    return { catalogo: this.estiloService.catalogo(), config, resuelto };
  }

  /**
   * PUT y no PATCH: la configuración se guarda ENTERA. Los cuatro colores se eligen
   * juntos y se validan juntos contra AA — un PATCH de un solo color obligaría a
   * validar la combinación resultante de un estado que el cliente no ha visto.
   */
  @Put()
  set(@Body() dto: SetEstiloDto, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.estiloService.setConfig(dto, user.userId, ip);
  }

  /** Vuelve al Modelo 0 de fábrica. Borra la fila; idempotente. */
  @Delete()
  reset(@CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.estiloService.reset(user.userId, ip);
  }
}
