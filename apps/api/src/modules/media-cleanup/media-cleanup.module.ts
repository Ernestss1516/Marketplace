import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_MEDIA_CLEANUP, retryQueue } from '../../infra/queue/queue.constants';
import { MediaCleanupService } from './media-cleanup.service';
import { PendingMediaService } from './pending-media.service';

/**
 * HUÉRFANAS H1 — módulo NEUTRAL, molde `ListingImagesModule` (2b).
 *
 * Lo importan cuatro módulos que no se ven entre sí (usuarios, blog, portada,
 * patrocinados) para usar el mismo cálculo. Sus dependencias son mínimas: la cola de
 * B3 y nada más — `PrismaModule` y `R2Module` son `@Global`.
 *
 * QUE LA COLA SE REGISTRE UNA SOLA VEZ, aquí, es además lo que evita la trampa
 * documentada en `queue.constants.ts`: `@nestjs/bullmq` crea **una instancia de
 * `Queue` por cada `registerQueue()` del mismo nombre**, así que registrarla en los
 * cuatro módulos habría dado cuatro productores distintos —cuatro sitios donde
 * comprobar los reintentos, y cuatro que espiar en los tests—.
 *
 * VÍDEO DE BLOQUE V1 — aquí vive también `PendingMediaService`, el GEMELO: uno cierra la
 * fuga de «lo que se suelta» (diff + cola) y el otro la de «lo que nunca se guarda»
 * (prefijo temporal + promoción al guardar). Son los dos mecanismos de
 * `diseno-huerfanas-sin-fila.md` §5, y los llaman los mismos servicios en la misma
 * operación —uno antes de escribir y el otro después—, así que comparten módulo en vez de
 * obligar a blog y portada a importar dos.
 */
@Module({
  imports: [BullModule.registerQueue(retryQueue(QUEUE_MEDIA_CLEANUP))],
  providers: [MediaCleanupService, PendingMediaService],
  exports: [MediaCleanupService, PendingMediaService],
})
export class MediaCleanupModule {}
