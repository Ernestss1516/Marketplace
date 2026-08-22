import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { R2Service } from '../../infra/r2/r2.service';
import { QUEUE_IMAGE } from '../../infra/queue/queue.constants';
import { pendingPrefix } from '../../infra/r2/media-keys';

/** Raíz de las claves de avatar. Compartida con `UsersService`, que es quien las confirma. */
export const AVATAR_KEY_PREFIX = 'avatars';

/** Exported so other upload endpoints (e.g. SponsoredAds) that bypass this service but still write to R2 can reuse the same mime→ext mapping instead of duplicating it. */
export const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const ALLOWED_MIME_TYPES = Object.keys(MIME_TO_EXT);
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    @InjectQueue(QUEUE_IMAGE) private readonly imageQueue: Queue,
  ) {}

  async upload(userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');

    const ext = MIME_TO_EXT[file.mimetype];
    if (!ext) throw new UnprocessableEntityException('File type not allowed. Use JPEG, PNG or WebP.');

    const key = `media/${randomBytes(16).toString('hex')}${ext}`;
    await this.r2.upload(key, file.buffer, file.mimetype);

    const url = this.r2.getPublicUrl(key);
    const image = await this.prisma.listingImage.create({
      data: { url, uploadedById: userId },
      select: { id: true, url: true, width: true, height: true },
    });

    await this.imageQueue.add('process', { mediaId: image.id, r2Key: key });

    return image;
  }

  /**
   * HUÉRFANAS H2 — EL AVATAR NACE EN EL PREFIJO TEMPORAL (fuga 1b).
   *
   * Este endpoint sube y devuelve una URL, pero **no guarda nada**: el avatar sólo queda
   * enlazado cuando el perfil se guarda (`UsersService.updateMe`). El formulario sube en
   * cuanto eliges el fichero, para poder previsualizarlo, así que cerrar la pestaña sin
   * guardar dejaba el objeto suelto en el bucket para siempre.
   *
   * Con `avatars/tmp/<userId>/…`, lo que no llegue a guardarse queda confinado bajo un
   * prefijo que la regla de ciclo de vida caduca sola. Es la misma figura que el vídeo sin
   * confirmar y el mismo mecanismo — ver `docs/diseno-huerfanas-sin-fila.md` §9.
   *
   * EL `userId` VA EN LA CLAVE, y por eso este método pasa a recibirlo (el controlador ya
   * lo tenía y lo ignoraba, `_user`): es lo que permite a `updateMe` rechazar la URL
   * temporal de OTRO usuario sin guardar ningún estado entre subir y guardar. Mismo
   * criterio que el vídeo, que rechaza la clave temporal de otro anuncio.
   */
  async uploadAvatar(userId: string, file: Express.Multer.File): Promise<{ url: string }> {
    if (!file) throw new BadRequestException('No file provided');

    const ext = MIME_TO_EXT[file.mimetype];
    if (!ext) throw new UnprocessableEntityException('File type not allowed. Use JPEG, PNG or WebP.');

    const key = `${pendingPrefix(AVATAR_KEY_PREFIX, userId)}${randomBytes(16).toString('hex')}${ext}`;
    await this.r2.upload(key, file.buffer, file.mimetype);

    return { url: this.r2.getPublicUrl(key) };
  }
}
