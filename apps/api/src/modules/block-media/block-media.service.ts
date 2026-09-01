import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { R2Service } from '../../infra/r2/r2.service';
import { pendingPrefix } from '../../infra/r2/media-keys';
import {
  ALLOWED_BLOCK_POSTER_MIME_TYPES,
  ALLOWED_BLOCK_VIDEO_MIME_TYPES,
  BLOCK_MEDIA_KEY_PREFIX,
  BLOCK_MEDIA_UPLOAD_URL_TTL_SECONDS,
  BLOCK_POSTER_MIME_TO_EXT,
  BLOCK_VIDEO_EXT,
  MAX_BLOCK_POSTER_BYTES,
  MAX_BLOCK_VIDEO_BYTES,
} from './block-media-limits';
import { PresignBlockVideoDto } from './dto/presign-block-video.dto';
import { PresignBlockPosterDto } from './dto/presign-block-poster.dto';

/** Lo que devuelve una firma. Misma forma que la del vídeo Pro: el cliente ya la conoce. */
export interface BlockMediaUploadTicket {
  uploadUrl: string;
  key: string;
  expiresInSeconds: number;
  /** Cabeceras que el PUT DEBE llevar, o la firma no casa. */
  requiredHeaders: Record<string, string>;
}

/** Las dos clases de objeto que viven bajo la raíz, con la regla que le toca a cada una. */
const REGLAS = {
  video: {
    maxBytes: MAX_BLOCK_VIDEO_BYTES,
    mimeTypes: ALLOWED_BLOCK_VIDEO_MIME_TYPES as readonly string[],
    queEs: 'El vídeo',
  },
  poster: {
    maxBytes: MAX_BLOCK_POSTER_BYTES,
    mimeTypes: ALLOWED_BLOCK_POSTER_MIME_TYPES as readonly string[],
    queEs: 'El póster',
  },
} as const;

/**
 * VÍDEO DE BLOQUE V1 — subir media pesada para el contenido editorial (blog, páginas y
 * portada), con los bytes FUERA de esta API.
 *
 * CAMINO PROPIO SOBRE LA INFRAESTRUCTURA QUE YA ES COMÚN, y esa es la decisión central del
 * diseño (`docs/diseno-video-bloque.md` §2). No se extrae nada de `VideoService`: lo
 * genérico —`R2Service.presignUpload`/`head`/`copy`/`delete`, `pendingPrefix`— **ya vive un
 * piso más abajo y ya lo comparten los dos**. Lo que queda en `VideoService` es justo lo
 * que no puede ser común: el interruptor de la feature, el guard de Pro, la propiedad y el
 * estado del anuncio, la escritura de cinco columnas de `Listing` y el reindexado. Un
 * servicio compartido habría dejado en común unas veinte líneas a cambio de siete puntos de
 * configuración y de atar dos features que hoy no se conocen.
 *
 * EN DOS TIEMPOS, PERO NO LOS MISMOS DOS QUE EL VÍDEO PRO:
 *   1. FIRMAR — se comprueba el rol, el tipo y el tamaño, y se emite un permiso acotado
 *      contra `blocks-videos/tmp/<userId>/`.
 *   2. CONFIRMAR — se comprueba contra el almacenamiento que lo que aterrizó es lo que se
 *      autorizó… y **NO SE MUEVE NADA**. Ver `confirmUpload`.
 *
 * LOS BYTES NO PASAN POR AQUÍ. No hay `FileInterceptor` ni `memoryStorage` en el
 * controlador de este módulo, y no puede haberlos: el único camino de subida es el PUT
 * prefirmado del navegador contra R2 (barrera B-1).
 */
@Injectable()
export class BlockMediaService {
  private readonly logger = new Logger(BlockMediaService.name);

  constructor(private readonly r2: R2Service) {}

  // ---------------------------------------------------------------------------
  // Paso 1 — validar y firmar
  // ---------------------------------------------------------------------------

  createVideoUploadUrl(userId: string, dto: PresignBlockVideoDto): Promise<BlockMediaUploadTicket> {
    // Otra vez aquí y no sólo en el DTO: el DTO valida la FORMA de la petición; esto es la
    // regla, y tiene que seguir siendo cierta aunque alguien llame al servicio desde otro
    // sitio. Mismo criterio que `VideoService.createUploadUrl`.
    if (!REGLAS.video.mimeTypes.includes(dto.contentType)) {
      throw new UnsupportedMediaTypeException('Solo se admite vídeo MP4 (H.264).');
    }
    if (dto.sizeBytes > MAX_BLOCK_VIDEO_BYTES) {
      throw new PayloadTooLargeException(
        `El vídeo supera el máximo de ${Math.round(MAX_BLOCK_VIDEO_BYTES / (1024 * 1024))} MB.`,
      );
    }

    return this.firmar(userId, dto.contentType, dto.sizeBytes, BLOCK_VIDEO_EXT);
  }

  createPosterUploadUrl(userId: string, dto: PresignBlockPosterDto): Promise<BlockMediaUploadTicket> {
    if (!REGLAS.poster.mimeTypes.includes(dto.contentType)) {
      throw new UnsupportedMediaTypeException('El póster debe ser una imagen WebP o JPEG.');
    }
    if (dto.sizeBytes > MAX_BLOCK_POSTER_BYTES) {
      throw new PayloadTooLargeException(
        `El póster supera el máximo de ${Math.round(MAX_BLOCK_POSTER_BYTES / 1024)} KB.`,
      );
    }

    const ext = BLOCK_POSTER_MIME_TO_EXT[dto.contentType] ?? '.webp';
    return this.firmar(userId, dto.contentType, dto.sizeBytes, ext);
  }

  /**
   * La firma, que es lo único que las dos rutas comparten de verdad.
   *
   * NACE BAJO `tmp/`, CON EL `userId` DENTRO DE LA CLAVE. Las dos cosas hacen trabajo:
   *
   *  - El `tmp/` confina lo que nunca llegue a guardarse, para que una regla de ciclo de
   *    vida pueda caducarlo sin poder tocar nada vivo. Va ARRIBA (`<raíz>/tmp/<dueño>/`,
   *    ver `pendingPrefix`) porque el filtro de una regla de ciclo de vida es un prefijo
   *    literal sin comodines.
   *  - El `userId` es lo que permite rechazar más tarde la promoción de una subida AJENA
   *    sin guardar ningún estado entre firmar y guardar. Mismo papel que el `listingId` en
   *    el vídeo Pro y el `userId` en el avatar.
   */
  private async firmar(
    userId: string,
    contentType: string,
    sizeBytes: number,
    ext: string,
  ): Promise<BlockMediaUploadTicket> {
    const key = `${pendingPrefix(BLOCK_MEDIA_KEY_PREFIX, userId)}${randomUUID()}${ext}`;

    // El tamaño declarado entra en la FIRMA. A partir de aquí el límite deja de depender de
    // que el cliente diga la verdad: si sube un cuerpo de otro tamaño, el almacenamiento
    // rechaza el PUT porque la firma no cubre esa petición.
    const uploadUrl = await this.r2.presignUpload({
      key,
      contentType,
      contentLength: sizeBytes,
      expiresInSeconds: BLOCK_MEDIA_UPLOAD_URL_TTL_SECONDS,
    });

    this.logger.log(`Media de bloque: URL firmada para user=${userId} (${sizeBytes} B)`);

    return {
      uploadUrl,
      key,
      expiresInSeconds: BLOCK_MEDIA_UPLOAD_URL_TTL_SECONDS,
      requiredHeaders: { 'Content-Type': contentType },
    };
  }

  // ---------------------------------------------------------------------------
  // Paso 2 — confirmar lo que de verdad aterrizó (SIN mover nada)
  // ---------------------------------------------------------------------------

  /**
   * EL CONFIRM NO COPIA, Y ESA ES LA DIFERENCIA CENTRAL CON EL VÍDEO PRO.
   *
   * Allí confirmar y persistir son el mismo gesto, así que sacar el objeto de `tmp/` en el
   * confirm es correcto: para cuando termina, una fila lo referencia. **Aquí no hay ninguna
   * fila todavía**: la URL viaja al editor, vive en un array en memoria y sólo se persiste
   * cuando alguien guarda el post o la portada, quizá media hora después.
   *
   * Si este confirm copiara al prefijo definitivo, un editor que sube un vídeo y cierra la
   * pestaña sin guardar dejaría hasta 50 MB **fuera de `tmp/`, donde la regla de ciclo de
   * vida no llega**: una huérfana permanente. Y «subo y no llego a guardar» no es un caso
   * raro, es *el* caso de abandono. Por eso el objeto se queda en `tmp/` y la copia ocurre
   * al guardar (`PendingMediaService`, §4.2 del diseño).
   *
   * Lo que sí hace es lo único que el servidor no puede delegar: mirar el objeto real. La
   * firma ya acota el tamaño, pero comprobarlo después distingue «dijo que subió» de
   * «subió», y detecta la confirmación de algo que nunca llegó.
   *
   * ES IDEMPOTENTE DE BALDE: como no mueve ni borra nada, confirmar dos veces vuelve a
   * mirar el mismo objeto y responde lo mismo.
   */
  async confirmUpload(userId: string, key: string): Promise<{ url: string }> {
    // La clave tiene que ser la temporal de ESTE usuario. Sin esto, cualquier EDITOR podría
    // confirmar —y meter en su post— la subida que otro acaba de hacer.
    const prefijoTemporal = pendingPrefix(BLOCK_MEDIA_KEY_PREFIX, userId);
    if (!key.startsWith(prefijoTemporal)) {
      throw new ForbiddenException('Esa subida no es tuya.');
    }

    const objeto = await this.r2.head(key);
    if (!objeto) {
      throw new BadRequestException('No encontramos el fichero subido. Vuelve a intentarlo.');
    }

    // QUÉ REGLA APLICA, DECIDIDO POR LA EXTENSIÓN Y NO POR LO QUE DIGA EL ALMACENAMIENTO.
    // La extensión la pusimos NOSOTROS al firmar, a partir de un `contentType` ya validado,
    // así que es el dato más fiable que hay aquí. El `contentType` que devuelve `head` se
    // usa como comprobación ADICIONAL cuando viene (algunos almacenamientos no lo
    // devuelven), nunca como clasificador: si fuera él quien elige la regla, un objeto sin
    // `contentType` no tendría ninguna.
    const regla = key.endsWith(BLOCK_VIDEO_EXT) ? REGLAS.video : REGLAS.poster;

    if (objeto.contentLength > regla.maxBytes) {
      // No debería ocurrir —el tamaño va dentro de la firma— pero comprobarlo aquí es lo
      // que hace que la garantía no dependa de una sola capa. Y lo que sobra se retira: un
      // objeto rechazado que se quedara en el bucket sería basura que nadie va a reclamar.
      await this.r2.delete(key).catch(() => undefined);
      throw new PayloadTooLargeException(`${regla.queEs} subido supera el tamaño permitido.`);
    }
    if (objeto.contentType && !regla.mimeTypes.includes(objeto.contentType)) {
      await this.r2.delete(key).catch(() => undefined);
      throw new UnsupportedMediaTypeException(`${regla.queEs} subido no tiene un formato admitido.`);
    }

    // La URL TEMPORAL, a propósito: es lo que el editor guarda en el bloque hasta que
    // alguien pulse guardar. El validador `@IsOwnStorageUrl` la acepta —comprueba el
    // dominio, no el prefijo— y el pase de promoción es quien la convierte en definitiva.
    return { url: this.r2.getPublicUrl(key) };
  }
}
