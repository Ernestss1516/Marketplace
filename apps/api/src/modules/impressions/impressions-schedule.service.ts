import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ImpressionsService } from './impressions.service';

/**
 * ESTADÍSTICAS A1 — el disparador del volcado y de la purga.
 *
 * Molde `InvoicingScheduleService` / `BumpScheduleService`, con su propiedad declarada:
 * **el `@Cron` es fino y delega en un método público testeable**. Aquí no hay lógica
 * ninguna; toda vive en `ImpressionsService`, que se puede disparar desde un test sin
 * esperar al planificador.
 *
 * HORARIO. El volcado corre cada 15 minutos, y el minuto es el que es por dos razones:
 *
 *  · **Cada 15 y no cada minuto**: el intervalo es lo que COALESCE. Un anuncio que
 *    aparece en cien búsquedas en ese cuarto de hora se escribe UNA vez, no cien. Con
 *    un intervalo de un minuto habría 1.440 volcados al día en vez de 96, y quince
 *    veces menos coalescing por cada uno.
 *  · **Cada 15 y no cada hora**: es el retraso máximo con el que el vendedor ve su
 *    número. La gráfica es DIARIA, así que quince minutos no se ven en ella; una hora
 *    ya se nota si alguien está mirando el contador del día en curso.
 *
 * La purga va con los otros barridos diarios de madrugada, y a las 06:00 para no
 * amontonarse con los cuatro que ya corren a las 02, 03, 04 y 05.
 */
@Injectable()
export class ImpressionsScheduleService {
  private readonly logger = new Logger(ImpressionsScheduleService.name);

  constructor(private readonly impressions: ImpressionsService) {}

  @Cron('*/15 * * * *')
  async runFlush(): Promise<void> {
    try {
      await this.impressions.flushImpressions();
    } catch (err) {
      // Un volcado que falla NO deja nada roto: los cubos siguen en Redis y el ciclo
      // siguiente los reintenta (ver la idempotencia de `flushImpressions`). Se registra
      // y se sigue, para que el planificador no muera con la excepción.
      this.logger.error(
        `Volcado de impresiones fallido: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @Cron('0 6 * * *')
  async runPurge(): Promise<void> {
    try {
      await this.impressions.purgeOldDailyRows();
    } catch (err) {
      this.logger.error(
        `Purga de telemetría diaria fallida: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
