// ============================================================================
//  infra/queue/processors/indexing.processor.ts
//  Worker de la cola 'indexing'. Cierra el circuito de la búsqueda:
//
//    ListingsService  --(encola job)-->  cola 'indexing'  --(consume)-->  ESTE worker
//                                                                              │
//                                                          recarga de Postgres │
//                                                          e indexa/retira en  ▼
//                                                                       SearchService
//
//  Se ejecuta fuera del ciclo de la petición HTTP, así que el reindexado nunca
//  penaliza la latencia del usuario.
// ============================================================================

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { SearchService } from '../../../modules/search/search.service';

// Mismo shape que espera SearchService.toDocument (category + images).
const INDEX_INCLUDE = {
  category: { select: { id: true, slug: true, name: true } },
  images: { orderBy: { order: 'asc' as const } },
};

@Processor('indexing')
export class IndexingProcessor extends WorkerHost {
  private readonly logger = new Logger(IndexingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
  ) {
    super();
  }

  /** Punto de entrada del worker. BullMQ enruta por el nombre del job. */
  async process(job: Job<{ listingId: string }>): Promise<void> {
    const { listingId } = job.data;
    switch (job.name) {
      case 'index':
        return this.handleIndex(listingId);
      case 'remove':
        return this.handleRemove(listingId);
      default:
        this.logger.warn(`Job de indexado desconocido: ${job.name}`);
    }
  }

  /**
   * Indexa (o retira) un anuncio. Recarga el dato fresco de Postgres porque entre
   * encolar y procesar el anuncio puede haber cambiado o desaparecido.
   */
  private async handleIndex(listingId: string): Promise<void> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: INDEX_INCLUDE,
    });

    // Si se borró entre medias, lo retiramos del índice para no dejar huérfanos.
    if (!listing) {
      await this.search.removeListing(listingId);
      this.logger.debug(`Anuncio ${listingId} no existe; retirado del índice.`);
      return;
    }

    // SearchService ya decide internamente: si no está ACTIVE, lo retira.
    await this.search.indexListing(listing);
    this.logger.debug(`Anuncio ${listingId} reindexado (estado: ${listing.status}).`);
  }

  /** Retira explícitamente un anuncio del índice (job 'remove'). */
  private async handleRemove(listingId: string): Promise<void> {
    await this.search.removeListing(listingId);
    this.logger.debug(`Anuncio ${listingId} retirado del índice.`);
  }
}

// ----------------------------------------------------------------------------
//  Registro (en infra/queue/queue.module.ts):
//
//   BullModule.registerQueue({
//     name: 'indexing',
//     defaultJobOptions: {
//       attempts: 3,                                  // reintenta si Meili falla
//       backoff: { type: 'exponential', delay: 2000 },
//       removeOnComplete: true,
//       removeOnFail: 100,
//     },
//   })
//
//  …y declarar IndexingProcessor como provider del módulo, importando también
//  PrismaModule y SearchModule para la inyección.
// ----------------------------------------------------------------------------
