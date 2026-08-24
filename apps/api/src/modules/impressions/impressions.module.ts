import { Module } from '@nestjs/common';
import { ImpressionsService } from './impressions.service';
import { ImpressionsScheduleService } from './impressions-schedule.service';

/**
 * ESTADÍSTICAS A1 — la captura de «veces listado».
 *
 * SIN CONTROLADOR, y no es un olvido: este módulo no expone nada. Escribe (desde el
 * controlador de búsqueda, que importa el servicio) y vuelca (desde su propio `@Cron`).
 * Quien LEE lo que aquí se captura son A2 (el vendedor Pro) y B1/B2 (el backoffice), y
 * ninguno de los dos pasa por aquí: leen las tablas.
 *
 * `PrismaModule` y `RedisModule` son `@Global`, así que no hace falta importarlos.
 */
@Module({
  providers: [ImpressionsService, ImpressionsScheduleService],
  exports: [ImpressionsService],
})
export class ImpressionsModule {}
