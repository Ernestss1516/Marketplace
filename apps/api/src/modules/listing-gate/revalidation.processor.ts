import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_REVALIDATION } from '../../infra/queue/queue.constants';
import { RevalidationService } from './revalidation.service';

/** El único job de esta cola: revisar el subárbol de una categoría y marcar. */
export const MARK_STALE_JOB = 'mark-stale';

export interface MarkStaleJobData {
  /** La categoría cuyo `attributeSchema` acaba de cambiar. */
  categoryId: string;
}

/**
 * PUERTA — RÁFAGA 2. El marcado, EN COLA.
 *
 * POR QUÉ NO INLINE en el PATCH del administrador: cambiar el schema de una
 * categoría raíz obliga a revalidar los anuncios de TODA su descendencia, que en
 * un marketplace real son decenas de miles. La regla de arquitectura del repo no
 * deja elección —el trabajo pesado va a colas, nunca en la petición HTTP— y
 * además aquí sería un mal negocio: el administrador esperaría un minuto a que
 * termine algo cuyo resultado no necesita ver.
 *
 * QUE VAYA DIFERIDO NO ROMPE NADA, y conviene ver por qué: el flag no cambia lo
 * que ve el comprador (el anuncio sigue ACTIVE y en el índice) ni lo que puede
 * hacer el vendedor mientras tanto (la regla nace apagada). Lo único que se
 * retrasa unos segundos es el AVISO. Y si el job se reintenta, marcar dos veces
 * el mismo anuncio es escribir `true` sobre `true`: idempotente por naturaleza.
 */
@Processor(QUEUE_REVALIDATION)
export class RevalidationProcessor extends WorkerHost {
  private readonly logger = new Logger(RevalidationProcessor.name);

  constructor(private readonly revalidation: RevalidationService) {
    super();
  }

  async process(job: Job<MarkStaleJobData>): Promise<void> {
    if (job.name !== MARK_STALE_JOB) return;

    const { categoryId } = job.data;
    if (!categoryId) {
      this.logger.warn(`Job ${job.id} sin categoryId — se descarta`);
      return;
    }
    await this.revalidation.markStaleInSubtree(categoryId);
  }
}
