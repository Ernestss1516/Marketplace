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
  ALLOWED_PREVIEW_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  MAX_PREVIEW_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  PREVIEW_KEY_PREFIX,
  PREVIEW_MIME_TO_EXT,
  VIDEO_ENABLED_SETTING,
  VIDEO_KEY_PREFIX,
  VIDEO_LIMITS,
  type VideoLimits,
  VIDEO_UPLOAD_URL_TTL_SECONDS,
} from './video-limits';
import { PresignVideoDto } from './dto/presign-video.dto';
import { PresignPreviewDto } from './dto/presign-preview.dto';
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

  /**
   * PÓSTER ANIMADO P1 — paso 1 del SPRITE. Molde literal de `createUploadUrl`, y la copia es
   * el objetivo: son el mismo gesto sobre otro artefacto.
   *
   * LOS TRES GUARDS, LOS MISMOS. Sin `assertPro` aquí, un no-Pro no podría subir vídeo pero
   * sí escribir objetos en el bucket por este camino — una puerta trasera abierta por la
   * puerta nueva, que es exactamente el error que `assertPro` existe para no cometer dos
   * veces (ver su comentario: esconder el botón no impide un POST directo).
   *
   * NO PASA POR `POST /media/upload`, y ésa es la otra mitad de la decisión: ese camino crea
   * una fila en `ListingImage` y encola `sharp`, que le generaría al sprite una miniatura de
   * 800 px que no usaría nadie. Ver `PREVIEW_KEY_PREFIX`.
   *
   * Ver docs/diseno-poster-animado.md §4.2.
   */
  async createPreviewUploadUrl(userId: string, dto: PresignPreviewDto) {
    await this.assertEnabled();
    await this.assertPro(userId);
    await this.assertOwnActiveListing(userId, dto.listingId);

    // Otra vez aquí y no sólo en el DTO, por el mismo motivo que en el vídeo: el DTO valida
    // la FORMA de la petición; esto es la regla, y tiene que seguir siendo cierta aunque
    // alguien llame al servicio desde otro sitio.
    if (!(ALLOWED_PREVIEW_MIME_TYPES as readonly string[]).includes(dto.contentType)) {
      throw new UnsupportedMediaTypeException(
        'La previsualización debe ser una imagen WebP o JPEG.',
      );
    }
    if (dto.sizeBytes > MAX_PREVIEW_BYTES) {
      throw new PayloadTooLargeException(
        `La previsualización supera el máximo de ${Math.round(MAX_PREVIEW_BYTES / 1024)} KB.`,
      );
    }

    // Nace en `listing-previews/tmp/<listingId>/`, igual que el vídeo: lo que se quede ahí
    // es una subida abandonada y la regla de ciclo de vida lo caduca sin código de
    // recolección. El `tmp` va ARRIBA para que el filtro sea un prefijo literal.
    const ext = PREVIEW_MIME_TO_EXT[dto.contentType] ?? '.webp';
    const key = `${pendingPrefix(PREVIEW_KEY_PREFIX, dto.listingId)}${randomUUID()}${ext}`;

    const uploadUrl = await this.r2.presignUpload({
      key,
      contentType: dto.contentType,
      // El tamaño entra en la firma: a partir de aquí el tope lo aplica el almacenamiento,
      // no la buena fe del cliente.
      contentLength: dto.sizeBytes,
      expiresInSeconds: VIDEO_UPLOAD_URL_TTL_SECONDS,
    });

    return {
      uploadUrl,
      key,
      expiresInSeconds: VIDEO_UPLOAD_URL_TTL_SECONDS,
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

    /**
     * PÓSTER ANIMADO P1 — EL SPRITE VIAJA EN ESTE MISMO CONFIRM, y no en uno propio.
     *
     * Porque **un sprite no tiene vida sin su vídeo**: confirmarlos por separado haría
     * representable un anuncio con previsualización y sin vídeo, que no significa nada. Un
     * solo `confirm` lo hace imposible, igual que el orden firmar→subir→confirmar hace
     * imposible el anuncio a medias.
     *
     * Y ES OPCIONAL DE VERDAD (B-4): si el cliente no manda `previewKey` —porque la captura
     * devolvió `null`, porque la firma falló o porque el PUT se cayó— el vídeo se confirma
     * igual y la columna queda `null`. Es la misma asimetría que el póster ya tenía: sin
     * previsualización se vive, sin vídeo no.
     */
    const previewUrl = dto.previewKey
      ? await this.resolverPreview(listingId, dto.previewKey)
      : null;

    // Un vídeo por anuncio: lo anterior se sustituye y se borra del almacenamiento, o
    // quedaría pagando sitio sin que nadie pueda verlo nunca más.
    const anteriores = {
      videoUrl: listing.videoUrl,
      videoPosterUrl: listing.videoPosterUrl,
      videoPreviewUrl: listing.videoPreviewUrl,
    };

    let actualizado;
    try {
      actualizado = await this.prisma.listing.update({
        where: { id: listingId },
        data: {
          videoUrl,
          videoPosterUrl: dto.posterUrl ?? null,
          videoPreviewUrl: previewUrl,
          videoDurationSeconds: dto.durationSeconds,
          videoUploadedAt: new Date(),
        },
        select: {
          id: true,
          slug: true,
          videoUrl: true,
          videoPosterUrl: true,
          videoPreviewUrl: true,
          videoUploadedAt: true,
        },
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

    // LOS TRES OBJETOS QUE SE VAN, no sólo el `.mp4`. Sustituir un vídeo deja atrás también
    // su póster y su sprite, y hasta P1 el póster se quedaba en el bucket para siempre (H-2).
    //
    // La comparación «lo viejo ≠ lo nuevo» importa desde H2 y ahora vale para los tres: en
    // una confirmación repetida la fila ya apunta a lo que se acaba de confirmar, y sin ella
    // se borraría el objeto recién guardado.
    await this.borrarLoQueSeVa(anteriores, {
      videoUrl,
      videoPosterUrl: dto.posterUrl ?? null,
      videoPreviewUrl: previewUrl,
    });
    await this.refrescarSuperficies(actualizado.slug, listingId);

    this.logger.log(`Vídeo confirmado para listing=${listingId} (${objeto.contentLength} B)`);
    return { ...actualizado, hasVideo: true };
  }

  // ---------------------------------------------------------------------------
  // Quitar
  // ---------------------------------------------------------------------------

  /**
   * PÓSTER ANIMADO P1 — AQUÍ SE CIERRA **H-2**.
   *
   * Este método ponía `videoPosterUrl: null` en la fila y **sólo borraba el `.mp4`**: el
   * objeto del póster se quedaba huérfano en el bucket en cuanto alguien quitaba su vídeo,
   * pagando sitio sin que nadie pudiera verlo nunca más. No se veía porque la fila quedaba
   * limpia, que es la clase de fuga que sólo aparece mirando el bucket.
   *
   * Añadir el sprite sin arreglarlo habría **triplicado** la fuga, y por eso la limpieza
   * entra en la MISMA ráfaga que el objeto: un objeto que se crea antes de que exista quien
   * lo borre es basura desde el primer día.
   */
  async removeVideo(userId: string, listingId: string) {
    const listing = await this.assertOwnListing(userId, listingId);
    if (!listing.videoUrl) return { hasVideo: false };

    await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        videoUrl: null,
        videoPosterUrl: null,
        videoPreviewUrl: null,
        videoDurationSeconds: null,
        videoUploadedAt: null,
      },
    });

    // Los TRES, por el mismo lector que usa la sustitución. Todo a `null`, así que «lo que
    // se va» es todo lo que había.
    await this.borrarLoQueSeVa(listing, {
      videoUrl: null,
      videoPosterUrl: null,
      videoPreviewUrl: null,
    });
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
      // Los TRES objetos, no sólo el `.mp4`: quien sustituye o quita un vídeo necesita saber
      // qué había para poder borrarlo (ver `borrarLoQueSeVa`). Es lo que faltaba en H-2.
      select: {
        id: true,
        slug: true,
        sellerId: true,
        status: true,
        videoUrl: true,
        videoPosterUrl: true,
        videoPreviewUrl: true,
      },
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

  /**
   * PÓSTER ANIMADO P1 — el sprite confirmado, del temporal a su sitio. **Mismo cuerpo que el
   * `.mp4`**, y por eso está escrito con la misma forma: comprobar que la clave es la
   * temporal de ESTE anuncio, comprobar contra el almacenamiento lo que aterrizó, copiar y
   * limpiar el temporal.
   *
   * LA CLAVE AJENA SE RECHAZA (B-7). Sin esta comprobación, cualquiera podría confirmar en su
   * anuncio un sprite subido para otro — y el dueño está en la clave precisamente para poder
   * rechazarlo sin guardar ningún estado entre firmar y confirmar.
   */
  private async resolverPreview(listingId: string, previewKey: string): Promise<string | null> {
    const prefijoTemporal = pendingPrefix(PREVIEW_KEY_PREFIX, listingId);
    if (!previewKey.startsWith(prefijoTemporal)) {
      throw new BadRequestException('Esa previsualización no corresponde a este anuncio.');
    }

    const claveDefinitiva = `${PREVIEW_KEY_PREFIX}/${listingId}/${previewKey.slice(prefijoTemporal.length)}`;

    // Idéntico al vídeo, y por el mismo caso: confirmar dos veces (doble clic, reintento de
    // red) llega con el temporal ya borrado, y mirar el destino hace la operación idempotente.
    const enTemporal = await this.r2.head(previewKey);
    const yaConfirmado = enTemporal === null;
    const objeto = enTemporal ?? (await this.r2.head(claveDefinitiva));

    /**
     * Y AQUÍ SE SEPARA DEL VÍDEO, en la única decisión que no se copia: **si el objeto no
     * está, no se lanza — se devuelve `null`**.
     *
     * El vídeo responde «no encontramos el vídeo subido» y aborta, porque sin él no hay nada
     * que confirmar. La previsualización es una mejora opcional, así que un fallo suyo no
     * puede costarle al vendedor el vídeo que sí subió (B-4). Se pierde el sprite y se
     * guarda el vídeo, que es el reparto correcto.
     */
    if (!objeto) {
      this.logger.warn(`Previsualización no encontrada al confirmar (${previewKey}); se sigue sin ella.`);
      return null;
    }

    // Los mismos dos topes de la firma, comprobados otra vez contra lo que de verdad
    // aterrizó: es lo que hace que la garantía no dependa de una sola capa. Un sprite que no
    // los pase se descarta y se borra — pero tampoco tumba el vídeo.
    if (
      objeto.contentLength > MAX_PREVIEW_BYTES ||
      (objeto.contentType && !(ALLOWED_PREVIEW_MIME_TYPES as readonly string[]).includes(objeto.contentType))
    ) {
      await this.r2.delete(yaConfirmado ? claveDefinitiva : previewKey).catch(() => undefined);
      this.logger.warn(`Previsualización rechazada al confirmar (${previewKey}); se sigue sin ella.`);
      return null;
    }

    if (!yaConfirmado) await this.r2.copy(previewKey, claveDefinitiva);

    const url = this.r2.getPublicUrl(claveDefinitiva);
    if (!isOwnStorageUrl(url)) return null;

    // Cortesía, como en el vídeo: si el temporal no se deja borrar, lo caducará la regla.
    if (!yaConfirmado) {
      await this.r2.delete(previewKey).catch((e) => {
        this.logger.warn(`No se pudo borrar el temporal ${previewKey}: ${String(e)}`);
      });
    }

    return url;
  }

  /**
   * PÓSTER ANIMADO P1 — LOS TRES OBJETOS DE UN VÍDEO, EN UN SOLO LECTOR.
   *
   * Un vídeo arrastra **tres** ficheros: el `.mp4`, el póster fijo y el sprite. Los dos
   * caminos que sueltan alguno —sustituir el vídeo y quitarlo— tienen que borrar los mismos
   * tres, y escribir esa lista dos veces es cómo se olvida uno en uno de los dos lados. Que
   * pasó: `removeVideo` se olvidaba del póster (H-2).
   *
   * BORRA SÓLO LO QUE CAMBIA. Si la URL nueva es la misma que la vieja —confirmación
   * repetida— no se toca: sin esa comparación se borraría el objeto recién guardado.
   *
   * SILENCIOSO, como todo lo que limpia en este servicio: «no dejar limpiar no debe romper
   * nada». Lo hereda de `deleteObjectByUrl`.
   */
  private async borrarLoQueSeVa(
    antes: { videoUrl: string | null; videoPosterUrl: string | null; videoPreviewUrl: string | null },
    despues: { videoUrl: string | null; videoPosterUrl: string | null; videoPreviewUrl: string | null },
  ): Promise<void> {
    for (const campo of ['videoUrl', 'videoPosterUrl', 'videoPreviewUrl'] as const) {
      const viejo = antes[campo];
      if (viejo && viejo !== despues[campo]) await this.deleteObjectByUrl(viejo);
    }
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
