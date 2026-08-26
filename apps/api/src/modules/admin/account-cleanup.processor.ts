import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_ACCOUNT_CLEANUP } from '../../infra/queue/queue.constants';
import { ACCOUNT_CLEANUP_JOB, DeleteListingJobData } from './account-cleanup.types';
import { AdminService } from './admin.service';



/**
 * BORRADO DE CUENTAS C5 — LOS ANUNCIOS DE UNA CUENTA VACIADA, UNO POR TRABAJO.
 *
 * ── POR QUÉ POR COLA Y NO EN UN BUCLE DENTRO DE LA PETICIÓN ─────────────────
 *
 * Un vendedor puede tener doscientos anuncios, y borrar cada uno toca Postgres,
 * Redis, Meilisearch y R2. Hacerlo en línea dejaría la petición del ADMIN abierta
 * minutos y, si se cortara a la mitad, la mitad de los anuncios quedarían vivos
 * sin nada que lo reintentara. Un trabajo por anuncio hereda los reintentos de la
 * cola y hace que un fallo aislado no arrastre a los demás.
 *
 * ── POR QUÉ VIVE EN AdminModule Y NO EN QueueModule ────────────────────────
 *
 * Porque necesita `AdminService` —es quien tiene `deleteListing`— y meterlo en
 * `QueueModule` obligaría a que ése importara `AdminModule` entero. El precedente
 * de un procesador dentro de su módulo de dominio ya existe: `BumpAutoProcessor`,
 * en `BumpScheduleModule`, con su `registerQueue` al lado.
 *
 * ── CERO LÓGICA DESTRUCTIVA NUEVA ──────────────────────────────────────────
 *
 * Llama a `deleteListing` TAL CUAL. De ahí salen gratis la cascada, los `SetNull`
 * con los snapshots de B1 —conversaciones, denuncias, tratos, valoraciones y
 * tickets sobreviven LEGIBLES—, el `AuditLog` por anuncio, la invalidación de
 * Redis, la salida de Meilisearch y la purga de R2 con sus miniaturas derivadas.
 */
@Processor(QUEUE_ACCOUNT_CLEANUP)
export class AccountCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(AccountCleanupProcessor.name);

  constructor(private readonly admin: AdminService) {
    super();
  }

  async process(job: Job<DeleteListingJobData>): Promise<void> {
    try {
      if (job.name !== ACCOUNT_CLEANUP_JOB.DELETE_LISTING) {
        this.logger.warn(`Trabajo desconocido en la cola de limpieza: ${job.name}`);
        return;
      }

      const { listingId, actorId } = job.data;
      // `deleteListing` sólo acepta ARCHIVED — es su salvaguarda de los dos pasos
      // y no se toca. Aquí se archiva primero, que es legal desde PAUSED, SOLD,
      // EXPIRED y REJECTED; los DRAFT y PENDING_REVIEW van por `discardDraft`,
      // que es su camino propio y también limpia su R2.
      await this.admin.eliminarAnuncioDeCuentaVaciada(listingId, actorId);
    } catch (err) {
      Sentry.captureException(err);
      throw err;
    }
  }
}
