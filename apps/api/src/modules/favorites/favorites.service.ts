import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

const FAVORITE_INCLUDE = {
  listing: {
    include: {
      category: { select: { id: true, slug: true, name: true } },
      images: { orderBy: { order: 'asc' as const }, take: 1 },
      seller: { select: { id: true, name: true, slug: true, avatarUrl: true } },
    },
  },
} satisfies Prisma.FavoriteInclude;

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async add(userId: string, listingId: string) {
    try {
      return await this.prisma.favorite.create({
        data: { userId, listingId },
        include: FAVORITE_INCLUDE,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
          // Already favorited — return existing record (idempotent)
          return this.prisma.favorite.findUnique({
            where: { userId_listingId: { userId, listingId } },
            include: FAVORITE_INCLUDE,
          });
        }
        if (err.code === 'P2003') {
          throw new NotFoundException(`Listing ${listingId} not found`);
        }
      }
      throw err;
    }
  }

  async remove(userId: string, listingId: string): Promise<void> {
    try {
      await this.prisma.favorite.delete({
        where: { userId_listingId: { userId, listingId } },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        // Not found — succeed silently (idempotent)
        return;
      }
      throw err;
    }
  }

  async batchCheck(userId: string, listingIds: string[]): Promise<string[]> {
    const rows = await this.prisma.favorite.findMany({
      where: { userId, listingId: { in: listingIds } },
      select: { listingId: true },
    });
    return rows.map((r) => r.listingId);
  }

  async isFavorited(userId: string, listingId: string): Promise<boolean> {
    const fav = await this.prisma.favorite.findUnique({
      where: { userId_listingId: { userId, listingId } },
      select: { id: true },
    });
    return fav !== null;
  }

  async findByUser(userId: string, page: number, perPage: number) {
    const [items, total] = await Promise.all([
      this.prisma.favorite.findMany({
        where: { userId },
        include: FAVORITE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.favorite.count({ where: { userId } }),
    ]);
    return { items, total, page, perPage, pages: Math.ceil(total / perPage) };
  }
}
