import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

const EDIT_WINDOW_MS = 72 * 60 * 60 * 1000;

const SELECT_AUTHOR = {
  id: true,
  name: true,
  slug: true,
  avatarUrl: true,
} as const;

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(authorId: string, dto: CreateReviewDto) {
    if (authorId === dto.targetId) {
      throw new BadRequestException('No puedes valorarte a ti mismo');
    }

    // Elegibilidad: debe existir una conversación entre author y target para ese anuncio
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        listingId: dto.listingId,
        OR: [
          { buyerId: authorId, sellerId: dto.targetId },
          { sellerId: authorId, buyerId: dto.targetId },
        ],
      },
      select: { id: true, listing: { select: { title: true } } },
    });
    if (!conversation) {
      throw new ForbiddenException(
        'Solo puedes valorar a usuarios con los que has tenido una conversación sobre este anuncio',
      );
    }

    try {
      return await this.prisma.review.create({
        data: {
          rating: dto.rating,
          comment: dto.comment,
          authorId,
          targetId: dto.targetId,
          listingId: dto.listingId,
          // Snapshot: sobrevive aunque el anuncio se borre más adelante (listingId → NULL)
          listingTitle: conversation.listing.title,
        },
        include: { author: { select: SELECT_AUTHOR } },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Ya has valorado a este usuario para este anuncio');
      }
      throw err;
    }
  }

  async getEligibility(authorId: string, listingId: string, targetId: string) {
    if (authorId === targetId) {
      return { canReview: false, alreadyReviewed: false };
    }

    const [conversation, existing] = await Promise.all([
      this.prisma.conversation.findFirst({
        where: {
          listingId,
          OR: [
            { buyerId: authorId, sellerId: targetId },
            { sellerId: authorId, buyerId: targetId },
          ],
        },
        select: { id: true },
      }),
      this.prisma.review.findUnique({
        where: { authorId_targetId_listingId: { authorId, targetId, listingId } },
        select: { id: true, createdAt: true },
      }),
    ]);

    return {
      canReview: !!conversation && !existing,
      alreadyReviewed: !!existing,
      existingReview: existing ?? null,
    };
  }

  async listForUser(slug: string, cursor?: string, limit = 10) {
    const user = await this.prisma.user.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const targetId = user.id;
    const take = limit + 1;

    let whereWithCursor: Prisma.ReviewWhereInput = { targetId };
    if (cursor) {
      const pivot = await this.prisma.review.findUnique({
        where: { id: cursor },
        select: { createdAt: true },
      });
      if (pivot) {
        whereWithCursor = { targetId, createdAt: { lt: pivot.createdAt } };
      }
    }

    const [raw, aggregate, groupBy] = await Promise.all([
      this.prisma.review.findMany({
        where: whereWithCursor,
        orderBy: { createdAt: 'desc' },
        take,
        include: { author: { select: SELECT_AUTHOR } },
      }),
      this.prisma.review.aggregate({
        where: { targetId },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      this.prisma.review.groupBy({
        by: ['rating'],
        where: { targetId },
        _count: true,
      }),
    ]);

    const hasMore = raw.length > limit;
    const items = raw.slice(0, limit);
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    const count = aggregate._count.rating;
    const average =
      count > 0 ? Math.round((aggregate._avg.rating ?? 0) * 10) / 10 : null;

    const distribution: Record<string, number> = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
    };
    for (const row of groupBy) {
      distribution[String(row.rating)] = row._count;
    }

    return { average, count, distribution, items, nextCursor };
  }

  async edit(id: string, authorId: string, dto: UpdateReviewDto) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Valoración no encontrada');
    if (review.authorId !== authorId) {
      throw new ForbiddenException('No tienes permiso para editar esta valoración');
    }
    if (Date.now() > review.createdAt.getTime() + EDIT_WINDOW_MS) {
      throw new ForbiddenException('El plazo de edición de 72 horas ha expirado');
    }

    return this.prisma.review.update({
      where: { id },
      data: { ...dto, editedAt: new Date() },
      include: { author: { select: SELECT_AUTHOR } },
    });
  }

  async remove(id: string, authorId: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Valoración no encontrada');
    if (review.authorId !== authorId) {
      throw new ForbiddenException('No tienes permiso para borrar esta valoración');
    }
    if (Date.now() > review.createdAt.getTime() + EDIT_WINDOW_MS) {
      throw new ForbiddenException('El plazo de borrado de 72 horas ha expirado');
    }

    await this.prisma.review.delete({ where: { id } });
  }
}
