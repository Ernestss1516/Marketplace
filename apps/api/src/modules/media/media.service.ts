import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { R2Service } from '../../infra/r2/r2.service';
import { QUEUE_IMAGE } from '../../infra/queue/queue.constants';

const MIME_TO_EXT: Record<string, string> = {
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
}
