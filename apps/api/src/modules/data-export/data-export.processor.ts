import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_DATA_EXPORT } from '../../infra/queue/queue.constants';
import { DataExportService } from './data-export.service';
import { BuildDataExportJobData } from './data-export.types';

/**
 * BORRADO DE CUENTAS C6 — EL WORKER QUE ARMA EL ZIP.
 *
 * ── VIVE EN `DataExportModule` Y NO EN `QueueModule` ────────────────────────
 *
 * Precedente exacto: `BumpAutoProcessor` en `BumpScheduleModule` y
 * `AccountCleanupProcessor` en `AdminModule` (C5). El procesador necesita el
 * servicio de su dominio, y traérselo a `QueueModule` obligaría a ese módulo
 * —que es infraestructura— a importar medio dominio.
 *
 * ── UN PROCESADOR FINO A PROPÓSITO ──────────────────────────────────────────
 *
 * Todo lo que hace es delegar. La lógica vive en `DataExportService.buildExport`,
 * donde los tests pueden llamarla sin cola y donde ya está la comprobación de
 * idempotencia. Un procesador con lógica dentro sería lógica que sólo se puede
 * ejercitar levantando Redis.
 *
 * ── FALLAR AQUÍ SÍ ES UN ERROR ──────────────────────────────────────────────
 *
 * Al revés que `MediaCleanupProcessor`, donde un objeto sin borrar es basura
 * invisible: aquí hay una persona esperando su ZIP. Se relanza para que BullMQ
 * reintente (`RETRY_JOB_OPTIONS`), y cuando se agotan los reintentos la fila pasa
 * a `FAILED` — porque un `PENDING` eterno no sólo miente en la pantalla, además
 * cuenta como exportación viva y dejaría a esa persona sin poder pedir otra.
 */
@Processor(QUEUE_DATA_EXPORT)
export class DataExportProcessor extends WorkerHost {
  private readonly logger = new Logger(DataExportProcessor.name);

  constructor(private readonly dataExport: DataExportService) {
    super();
  }

  async process(job: Job<BuildDataExportJobData>): Promise<void> {
    const { exportId } = job.data;
    if (!exportId) return;

    try {
      await this.dataExport.buildExport(exportId);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.logger.error(`La exportación ${exportId} falló: ${motivo}`);

      // `attemptsMade` es 0 en el primer intento, así que el último es
      // `attempts - 1`. Sólo entonces se marca FAILED: hacerlo antes cerraría la
      // puerta a un reintento que todavía puede salir bien.
      const ultimoIntento = job.attemptsMade >= (job.opts.attempts ?? 1) - 1;
      if (ultimoIntento) {
        await this.dataExport.markFailed(exportId, motivo);
        Sentry.captureException(err);
      }

      throw err;
    }
  }
}
