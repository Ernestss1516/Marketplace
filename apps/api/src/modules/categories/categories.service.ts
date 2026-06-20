import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  findTree() {
    return this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        iconUrl: true,
        children: {
          orderBy: { order: 'asc' },
          select: { id: true, name: true, slug: true, iconUrl: true },
        },
      },
    });
  }

  async findBySlug(slug: string) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true, attributeSchema: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }
}
