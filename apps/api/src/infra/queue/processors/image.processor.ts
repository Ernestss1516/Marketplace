import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import sharp from 'sharp';
import { QUEUE_IMAGE } from '../queue.constants';
import { R2Service } from '../../r2/r2.service';
import { PrismaService } from '../../prisma/prisma.service';

interface ImageJobData {
  mediaId: string;
  r2Key: string;
}

@Processor(QUEUE_IMAGE)
export class ImageProcessor extends WorkerHost {
  constructor(
    private readonly r2: R2Service,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<ImageJobData>): Promise<void> {
    const { mediaId, r2Key } = job.data;

    const original = await this.r2.download(r2Key);
    const metadata = await sharp(original).metadata();

    const thumb = await sharp(original)
      .resize({ width: 800, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    const thumbKey = r2Key.replace(/\.[^.]+$/, '-thumb.webp');
    await this.r2.upload(thumbKey, thumb, 'image/webp');

    await this.prisma.listingImage.update({
      where: { id: mediaId },
      data: { width: metadata.width ?? null, height: metadata.height ?? null },
    });
  }
}
