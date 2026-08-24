import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { MinRole } from '../../common/decorators';
import { AdminStatsService } from './admin-stats.service';
import { StatsRangeDto } from './dto/stats-range.dto';

/**
 * ESTADÍSTICAS B1 — la telemetría agregada, para MODERATOR y ADMIN.
 *
 * ─── CONTROLADOR NUEVO Y NO UN `@Get` MÁS EN `AdminController` ───────────────────
 *
 * Dos razones, y la primera es de acceso:
 *
 * **`GET /admin/stats` (el dashboard) es EDITOR**, por un override explícito y razonado
 * (`admin.controller.ts:45-57`): es lo que carga `/admin`, la sección de piso más bajo del
 * backoffice. Colgar de ahí la telemetría —que es MODERATOR— dejaba dos salidas y las dos
 * malas: abrir los datos de tráfico a EDITOR, o devolver una respuesta de forma variable
 * según el rol. Lo segundo ya se consideró y se rechazó con esas palabras en
 * `docs/diseno-roles.md` §4.5 (D-2). Así que: endpoints nuevos, piso propio.
 *
 * **Y son cosas distintas.** Las siete métricas del dashboard son INVENTARIO (cuántos
 * anuncios, cuántos usuarios, cuántos reportes pendientes); éstas son TRÁFICO. Mezclarlas
 * en un endpoint las obliga a compartir cadencia, caché y piso de rol para siempre.
 *
 * De paso empieza a pagar la deuda declarada en `admin.controller.ts:276-280` —partir un
 * controlador de 22 rutas y tres pisos— **sin mover ni una ruta existente**: nace fuera en
 * vez de engordar el problema.
 *
 * ─── LA RUTA NO COLISIONA CON `GET /admin/stats` ─────────────────────────────────
 *
 * Aquél es la ruta EXACTA `admin/stats`; éste monta `admin/stats/listings/:id` y
 * `admin/stats/users/:id`. Nest las distingue por path completo, no por prefijo.
 *
 * ─── EL PISO ─────────────────────────────────────────────────────────────────────
 *
 * `MODERATOR` a nivel de CLASE, que es lo que exige el invariante INV-2 y lo que
 * `admin-controllers.contract.spec.ts` comprueba automáticamente sobre todo controlador
 * bajo `/admin` descubierto del disco — incluido éste, sin tocar el test. Encaja con el
 * reparto: `/admin/anuncios` y `/admin/usuarios`, las dos pantallas donde aterrizan estos
 * datos, ya son MODERATOR. Las estadísticas de un anuncio son menos sensibles que la
 * ficha del anuncio desde la que se abren.
 */
@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Controller('admin/stats')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole(Role.MODERATOR)
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsService) {}

  @Get('listings/:id')
  @ApiOperation({
    summary: 'Actividad de un anuncio (B.1)',
    description:
      'Serie diaria de visitas y de «veces listado» del anuncio, más sus totales y los dos ' +
      'ratios (CTR y me gusta) con el mismo tratamiento de muestra pequeña que ve el ' +
      'vendedor Pro. Sólo LEE la telemetría capturada por trackView y por el volcado de ' +
      'impresiones: no cuenta nada por su cuenta.',
  })
  listing(@Param('id') id: string, @Query() query: StatsRangeDto) {
    return this.stats.listingActivity(id, query.days ?? 30);
  }

  @Get('users/:id')
  @ApiOperation({
    summary: 'Actividad del conjunto de anuncios de un usuario (B.2)',
    description:
      'Los mismos datos que la actividad de un anuncio, pero sumando TODOS los anuncios ' +
      'del usuario (cualquier estado, no sólo ACTIVE), más su anuncio más visto y el más ' +
      'listado. La suma es un GROUP BY sobre las mismas tablas diarias — no hay tabla de ' +
      'agregado por usuario.',
  })
  user(@Param('id') id: string, @Query() query: StatsRangeDto) {
    return this.stats.userActivity(id, query.days ?? 30);
  }
}
