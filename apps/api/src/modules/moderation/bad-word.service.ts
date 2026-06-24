import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Checks listing text against the configurable bad-word list stored in Setting.
 *
 * FALLBACK CONTRACT (mirrors geocoding): if the list is absent, empty, or the
 * service throws for any reason, hasBadWords() returns false and publication
 * continues normally → ACTIVE. Moderation must never block the publish flow.
 */
@Injectable()
export class BadWordService {
  private readonly logger = new Logger(BadWordService.name);

  constructor(private readonly prisma: PrismaService) {}

  async hasBadWords(title: string, description: string): Promise<boolean> {
    try {
      const setting = await this.prisma.setting.findUnique({
        where: { key: 'badWordList' },
      });

      const words = setting?.value as string[] | null | undefined;
      if (!words?.length) return false;

      const normalizedWords = words.map((w) => this.normalize(w)).filter(Boolean);
      if (!normalizedWords.length) return false;

      const tokens = this.tokenize(`${title} ${description}`);
      return normalizedWords.some((w) => tokens.has(w));
    } catch (err) {
      this.logger.error('BadWordService error — falling back to no-filter', err);
      return false;
    }
  }

  private normalize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      this.normalize(text)
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    );
  }
}
