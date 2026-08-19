import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_MEDIA_CLEANUP } from '../queue.constants';
import { R2Service } from '../../r2/r2.service';

export interface MediaCleanupJobData {
  /** Claves de R2 ya resueltas. Ver por qué no un `listingId` en `media-keys.ts`. */
  keys: string[];
  /** Para el log: de qué venía este barrido («listing:abc123»). Informativo. */
  origen?: string;
}

/**
 * BORRADO B3 — RETIRAR DEL BUCKET LO QUE YA NO TIENE DUEÑO.
 *
 * POR QUÉ UNA COLA Y NO UN BORRADO EN LÍNEA. R2 es I/O externa y no entra en la
 * transacción de Postgres, así que el borrado del anuncio y el de sus ficheros no
 * pueden ser atómicos entre sí. Puestos a elegir dónde cae el fallo, se elige el
 * lado barato: **la BD queda consistente y la limpieza se reintenta**. Un objeto
 * que no se llega a borrar es BASURA —ocupa y cuesta, pero no se ve en ninguna
 * parte y se puede volver a intentar—; un anuncio que no se borra porque el
 * bucket no respondía sería corrupción de la decisión que tomó una persona.
 *
 * De ahí que la limpieza vaya DESPUÉS de la transacción y no pueda tumbarla.
 *
 * FALLAR AQUÍ NO ES UN ERROR DE NEGOCIO. Se borra clave a clave y un fallo suelto
 * no aborta el resto: si una imagen no se deja borrar, las otras nueve sí. Es el
 * mismo criterio —y las mismas palabras— que `VideoService.deleteObjectByUrl`,
 * que ya lo hacía para el vídeo: «no dejar limpiar no debe romper nada».
 *
 * PERO SÍ SE REPORTA. Si el job entero acaba sin poder borrar nada, se lanza para
 * que BullMQ lo reintente (`RETRY_JOB_OPTIONS`) y Sentry lo vea: un bucket que
 * rechaza TODO no es un fichero rebelde, es una credencial caducada o un permiso
 * mal puesto, y eso se arregla, no se tolera.
 */
@Processor(QUEUE_MEDIA_CLEANUP)
export class MediaCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaCleanupProcessor.name);

  constructor(private readonly r2: R2Service) {
    super();
  }

  async process(job: Job<MediaCleanupJobData>): Promise<void> {
    const { keys, origen } = job.data;
    if (!keys?.length) return;

    let fallidas = 0;
    for (const key of keys) {
      try {
        await this.r2.delete(key);
      } catch (err) {
        fallidas += 1;
        this.logger.warn(`No se pudo borrar el objeto ${key}: ${String(err)}`);
      }
    }

    if (fallidas === 0) return;

    // Parcial: se deja constancia y se da por bueno. Reintentar el job entero
    // volvería a borrar las que YA se borraron —un DELETE sobre una clave
    // inexistente es un no-op en S3, así que sería inofensivo pero inútil— y el
    // objetivo es no dejar el resto sin limpiar por culpa de una.
    if (fallidas < keys.length) {
      this.logger.warn(
        `Limpieza parcial (${fallidas}/${keys.length} objetos no borrados)${origen ? ` — ${origen}` : ''}`,
      );
      return;
    }

    // Total: no es un fichero, es el bucket. Se propaga para que se reintente y
    // para que quede en Sentry.
    const error = new Error(
      `No se pudo borrar NINGUNO de los ${keys.length} objetos${origen ? ` de ${origen}` : ''}`,
    );
    Sentry.captureException(error);
    throw error;
  }
}
