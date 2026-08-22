import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ListingStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { R2Service } from '../../infra/r2/r2.service';
import { listingCacheKey } from '../../infra/redis/cache-keys';
import { pendingPrefix } from '../../infra/r2/media-keys';
import { isOwnStorageUrl } from '../../common/validators/safe-url';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { EntitlementService } from '../billing/entitlement.service';
import {
  ALLOWED_VIDEO_MIME_TYPES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  VIDEO_ENABLED_SETTING,
  VIDEO_KEY_PREFIX,
  VIDEO_LIMITS,
  type VideoLimits,
  VIDEO_UPLOAD_URL_TTL_SECONDS,
} from './video-limits';
import { PresignVideoDto } from './dto/presign-video.dto';
import { ConfirmVideoDto } from './dto/confirm-video.dto';

/**
 * Vídeo Pro — LA INFRAESTRUCTURA (ráfaga 1). Sin UI y sin las superficies.
 *
 * EL PRINCIPIO: los bytes del vídeo NUNCA pasan por esta API. El navegador sube directamente
 * al almacenamiento con una URL prefirmada; aquí solo se valida y se firma. El camino de
 * imágenes usa `memoryStorage()`, que con ficheros de decenas de megas pondría el fichero
 * entero en la RAM del proceso que atiende toda la API.
 *
 * EN DOS TIEMPOS, y el orden importa:
 *   1. FIRMAR — se comprueba el gate (feature encendida, usuario Pro, anuncio suyo y activo)
 *      y los límites, y solo entonces se emite un permiso de subida acotado.
 *   2. CONFIRMAR — se comprueba contra el almacenamiento que lo que aterrizó es lo que se
 *      autorizó, y solo entonces se enlaza al anuncio.
 * Entre los dos pasos no hay nada enlazado: una subida abandonada deja un objeto huérfano
 * que NO se muestra en ninguna parte, porque el anuncio no lo referencia.
 */
@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly redis: RedisService,
    private readonly entitlements: EntitlementService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
  ) {}

  /**
   * La configuración vigente: si la feature está encendida y con qué límites.
   *
   * `enabled` viaja aquí para que el editor no tenga que preguntar por otro sitio si la
   * sección existe. Es lo mismo que el guard aplica al firmar, así que interfaz y servidor
   * no pueden discrepar: si esto dice `false`, firmar también fallaría.
   */
  async getConfig(): Promise<VideoLimits & { enabled: boolean }> {
    return { enabled: await this.isEnabled(), ...VIDEO_LIMITS };
  }

  // ---------------------------------------------------------------------------
  // Paso 1 — validar y firmar
  // ---------------------------------------------------------------------------

  async createUploadUrl(userId: string, dto: PresignVideoDto) {
    await this.assertEnabled();
    await this.assertPro(userId);
    await this.assertOwnActiveListing(userId, dto.listingId);

    // Los límites, otra vez aquí y no solo en el DTO: el DTO valida la FORMA de la petición;
    // esto es la regla de negocio, y tiene que seguir siendo cierta aunque alguien llame al
    // servicio desde otro sitio.
    if (!(ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(dto.contentType)) {
      throw new UnsupportedMediaTypeException('Solo se admite vídeo MP4 (H.264).');
    }
    if (dto.sizeBytes > MAX_VIDEO_BYTES) {
      throw new PayloadTooLargeException(
        `El vídeo supera el máximo de ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB.`,
      );
    }
    if (dto.durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
      throw new BadRequestException(
        `El vídeo no puede durar más de ${MAX_VIDEO_DURATION_SECONDS} segundos.`,
      );
    }

    // HUÉRFANAS H2 — SE FIRMA CONTRA EL PREFIJO TEMPORAL. El objeto nace en
    // `listing-videos/tmp/<listingId>/…` y sólo sale de ahí al confirmarse (`confirmUpload`
    // lo copia al definitivo). Lo que se quede aquí es una subida abandonada, y una regla
    // de ciclo de vida sobre ese prefijo la caduca sin que haga falta código de
    // recolección — que es todo el motivo de que el `tmp` esté ARRIBA y no detrás del
    // `listingId`: un filtro de ciclo de vida es un prefijo literal, sin comodines.
    //
    // Antes se firmaba directamente contra el definitivo, así que el vídeo vivo y el
    // abandonado eran indistinguibles y ninguna regla podía tocar uno sin tocar el otro.
    const key = `${pendingPrefix(VIDEO_KEY_PREFIX, dto.listingId)}${randomUUID()}.mp4`;

    // El tamaño declarado entra en la FIRMA. A partir de aquí el límite deja de depender de
    // que el cliente diga la verdad: si sube un cuerpo de otro tamaño, el almacenamiento
    // rechaza el PUT porque la firma no cubre esa petición.
    const uploadUrl = await this.r2.presignUpload({
      key,
      contentType: dto.contentType,
      contentLength: dto.sizeBytes,
      expiresInSeconds: VIDEO_UPLOAD_URL_TTL_SECONDS,
    });

    this.logger.log(`Vídeo: URL de subida firmada para listing=${dto.listingId} (${dto.sizeBytes} B)`);

    return {
      uploadUrl,
      key,
      expiresInSeconds: VIDEO_UPLOAD_URL_TTL_SECONDS,
      /** Cabeceras que el PUT DEBE llevar, o la firma no casa. */
      requiredHeaders: { 'Content-Type': dto.contentType },
    };
  }

  // ---------------------------------------------------------------------------
  // Paso 2 — confirmar lo que de verdad aterrizó
  // ---------------------------------------------------------------------------

  async confirmUpload(userId: string, listingId: string, dto: ConfirmVideoDto) {
    await this.assertEnabled();
    await this.assertPro(userId);
    const listing = await this.assertOwnActiveListing(userId, listingId);

    // La clave tiene que ser la TEMPORAL de ESTE anuncio. Sin esto, alguien podría confirmar
    // en su anuncio un objeto subido para otro. La comprobación no se relaja con H2: se
    // mueve al prefijo temporal, que es donde `createUploadUrl` firma ahora.
    const prefijoTemporal = pendingPrefix(VIDEO_KEY_PREFIX, listingId);
    if (!dto.key.startsWith(prefijoTemporal)) {
      throw new BadRequestException('Esa subida no corresponde a este anuncio.');
    }

    // El destino: la MISMA clave sin el `tmp/`, o sea el prefijo de siempre. Que el destino
    // no cambie es lo que deja fuera de la regla de caducidad a los vídeos ya confirmados
    // antes de H2, sin migrar ni una fila.
    const claveDefinitiva = `${VIDEO_KEY_PREFIX}/${listingId}/${dto.key.slice(prefijoTemporal.length)}`;

    // Comprobar contra el almacenamiento distingue «dijo que subió» de «subió». Y detecta la
    // confirmación de un objeto que nunca llegó (subida cancelada, red caída).
    //
    // CONFIRMAR DOS VECES (doble clic, reintento de red) llega aquí con el temporal ya
    // borrado por la primera confirmación. Sin mirar el destino, la respuesta sería «no
    // encontramos el vídeo subido» sobre un vídeo que está perfectamente guardado. Se mira,
    // y si ya está en su sitio la confirmación es idempotente: se rehacen las mismas
    // escrituras y no se copia nada.
    const enTemporal = await this.r2.head(dto.key);
    const yaConfirmado = enTemporal === null;
    const objeto = enTemporal ?? (await this.r2.head(claveDefinitiva));
    if (!objeto) {
      throw new BadRequestException('No encontramos el vídeo subido. Vuelve a intentarlo.');
    }

    const claveInspeccionada = yaConfirmado ? claveDefinitiva : dto.key;
    if (objeto.contentLength > MAX_VIDEO_BYTES) {
      // No debería ocurrir —la firma lo impide— pero comprobarlo aquí es lo que hace que la
      // garantía no dependa de una sola capa.
      await this.r2.delete(claveInspeccionada).catch(() => undefined);
      throw new PayloadTooLargeException('El vídeo subido supera el tamaño permitido.');
    }
    if (objeto.contentType && !(ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(objeto.contentType)) {
      await this.r2.delete(claveInspeccionada).catch(() => undefined);
      throw new UnsupportedMediaTypeException('El vídeo subido no es MP4.');
    }

    // LA COPIA, del lado del almacenamiento: los bytes no pasan por la API. A partir de
    // aquí el vídeo vive fuera de `tmp/` y la regla de caducidad ya no puede tocarlo.
    if (!yaConfirmado) await this.r2.copy(dto.key, claveDefinitiva);

    const videoUrl = this.r2.getPublicUrl(claveDefinitiva);
    // Cinturón y tirantes: la URL la construimos nosotros, así que esto no puede fallar. Que
    // esté escrito es lo que impide que un cambio futuro en `getPublicUrl` deje entrar una
    // dirección ajena sin que nadie se entere.
    if (!isOwnStorageUrl(videoUrl)) {
      throw new BadRequestException('La URL del vídeo no pertenece a nuestro almacenamiento.');
    }

    // Un vídeo por anuncio: el anterior se sustituye y se borra del almacenamiento, o
    // quedaría pagando sitio sin que nadie pueda verlo nunca más.
    const anterior = listing.videoUrl;

    let actualizado;
    try {
      actualizado = await this.prisma.listing.update({
        where: { id: listingId },
        data: {
          videoUrl,
          videoPosterUrl: dto.posterUrl ?? null,
          videoDurationSeconds: dto.durationSeconds,
          videoUploadedAt: new Date(),
        },
        select: { id: true, slug: true, videoUrl: true, videoPosterUrl: true, videoUploadedAt: true },
      });
    } catch (err) {
      // COMPENSACIÓN — el único fallo nuevo que introduce la copia. Si la fila no se
      // escribe, la copia se queda en el prefijo DEFINITIVO, donde nadie la referencia y
      // donde la regla de caducidad NO llega (sólo mira `tmp/`). Sería una huérfana
      // permanente, así que se deshace aquí. El original sigue en `tmp/` y lo caducará la
      // regla, así que reintentar la subida no pierde nada.
      if (!yaConfirmado) {
        await this.r2.delete(claveDefinitiva).catch((e) => {
          this.logger.warn(`No se pudo deshacer la copia ${claveDefinitiva}: ${String(e)}`);
        });
      }
      throw err;
    }

    // CORTESÍA, no corrección: el temporal ya no hace falta. Si el borrado falla, la regla
    // de caducidad lo recogerá — «no dejar limpiar no debe romper nada».
    if (!yaConfirmado) {
      await this.r2.delete(dto.key).catch((e) => {
        this.logger.warn(`No se pudo borrar el temporal ${dto.key}: ${String(e)}`);
      });
    }

    // `anterior !== videoUrl` importa desde H2: en una confirmación repetida la fila ya
    // apunta al vídeo que se acaba de confirmar, y sin esta comparación se borraría el
    // objeto recién guardado.
    if (anterior && anterior !== videoUrl) await this.deleteObjectByUrl(anterior);
    await this.refrescarSuperficies(actualizado.slug, listingId);

    this.logger.log(`Vídeo confirmado para listing=${listingId} (${objeto.contentLength} B)`);
    return { ...actualizado, hasVideo: true };
  }

  // ---------------------------------------------------------------------------
  // Quitar
  // ---------------------------------------------------------------------------

  async removeVideo(userId: string, listingId: string) {
    const listing = await this.assertOwnListing(userId, listingId);
    if (!listing.videoUrl) return { hasVideo: false };

    await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        videoUrl: null,
        videoPosterUrl: null,
        videoDurationSeconds: null,
        videoUploadedAt: null,
      },
    });
    await this.deleteObjectByUrl(listing.videoUrl);
    await this.refrescarSuperficies(listing.slug, listingId);

    return { hasVideo: false };
  }

  // ---------------------------------------------------------------------------
  // Guards y utilidades
  // ---------------------------------------------------------------------------

  /**
   * Requisito 1 — el interruptor de admin. SIN FILA, APAGADA.
   *
   * Al revés que el del bump automático (que sin fila está encendido), y a propósito: aquí
   * la feature cuesta almacenamiento y ancho de banda desde el primer vídeo, así que lo
   * prudente es que encenderla sea un acto explícito.
   */
  private async isEnabled(): Promise<boolean> {
    const ajuste = await this.prisma.setting.findUnique({
      where: { key: VIDEO_ENABLED_SETTING },
      select: { value: true },
    });
    return ajuste?.value === true;
  }

  private async assertEnabled(): Promise<void> {
    if (!(await this.isEnabled())) {
      throw new BadRequestException({
        code: 'VIDEO_DISABLED',
        message: 'El vídeo en anuncios no está disponible ahora mismo.',
      });
    }
  }

  /**
   * Requisito 3 — es un beneficio Pro, y se comprueba EN EL SERVIDOR.
   *
   * Esconder la sección en el editor no impide un POST directo, y lo que está en juego es
   * quién consume almacenamiento. Mismo criterio que el guard `ALREADY_SUBSCRIBED`.
   */
  private async assertPro(userId: string): Promise<void> {
    if (!(await this.entitlements.isProActive(userId))) {
      throw new ForbiddenException({
        code: 'PRO_REQUIRED',
        message: 'El vídeo en anuncios es una ventaja del plan Pro.',
      });
    }
  }

  private async assertOwnListing(userId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, slug: true, sellerId: true, status: true, videoUrl: true },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.sellerId !== userId) throw new ForbiddenException('Ese anuncio no es tuyo');
    return listing;
  }

  /** Para subir hace falta además que el anuncio esté vivo; para quitar el vídeo, no. */
  private async assertOwnActiveListing(userId: string, listingId: string) {
    const listing = await this.assertOwnListing(userId, listingId);
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Solo se puede añadir vídeo a anuncios activos.');
    }
    return listing;
  }

  /** Borra el objeto de una URL propia. Silencioso: no dejar limpiar no debe romper nada. */
  private async deleteObjectByUrl(url: string): Promise<void> {
    if (!isOwnStorageUrl(url)) return;
    const key = url.slice(this.r2.getPublicUrl('').length);
    await this.r2.delete(key).catch((err) => {
      this.logger.warn(`No se pudo borrar el objeto de vídeo ${key}: ${String(err)}`);
    });
  }

  /**
   * La ficha se sirve de un blob en Redis 5 min. Sin invalidar, un vídeo recién subido —o
   * recién quitado— tardaría hasta cinco minutos en verse. Mismo gesto que hace `bump` por
   * la misma razón; el fichero `cache-keys.ts` existe justamente para compartir la clave.
   */
  private invalidateFicha(slug: string) {
    return this.redis.client.del(listingCacheKey(slug));
  }

  /**
   * Refresca lo que las LISTAS ven de este anuncio.
   *
   * Las tarjetas de búsqueda no salen de Postgres: salen del documento indexado, que lleva
   * `hasVideo`. Sin reindexar, un vídeo recién subido no pondría el icono en los resultados
   * —y uno recién quitado lo seguiría mostrando— hasta la próxima vez que el anuncio se
   * tocara por cualquier otro motivo. Mismo gesto que hace `bump` al cambiar `bumpedAt`.
   */
  private reindex(listingId: string) {
    return this.indexingQueue.add('index', { listingId });
  }

  /** Los dos efectos que un cambio de vídeo tiene fuera del anuncio, siempre juntos. */
  private async refrescarSuperficies(slug: string, listingId: string): Promise<void> {
    await this.invalidateFicha(slug);
    await this.reindex(listingId);
  }
}
