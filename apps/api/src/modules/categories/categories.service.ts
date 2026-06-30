import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AttributeField, resolveEffectiveSchema } from './category.types';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findTree() {
    const roots = await this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        iconUrl: true,
        attributeSchema: true,
        children: {
          orderBy: { order: 'asc' },
          select: { id: true, name: true, slug: true, iconUrl: true, attributeSchema: true },
        },
      },
    });

    return roots.map((root) => {
      const rootSchema = (root.attributeSchema as unknown as AttributeField[]) ?? [];
      return {
        id: root.id,
        name: root.name,
        slug: root.slug,
        iconUrl: root.iconUrl,
        cardAttributes: rootSchema
          .filter((f) => f.cardAttribute)
          .map((f) => ({ key: f.name, label: f.label, ...(f.unit !== undefined ? { unit: f.unit } : {}) })),
        children: root.children.map((child) => {
          const childSchema = (child.attributeSchema as unknown as AttributeField[]) ?? [];
          const effective = resolveEffectiveSchema(childSchema, rootSchema);
          return {
            id: child.id,
            name: child.name,
            slug: child.slug,
            iconUrl: child.iconUrl,
            cardAttributes: effective
              .filter((f) => f.cardAttribute)
              .map((f) => ({ key: f.name, label: f.label, ...(f.unit !== undefined ? { unit: f.unit } : {}) })),
          };
        }),
      };
    });
  }

  async findBySlug(slug: string) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        attributeSchema: true,
        parent: { select: { attributeSchema: true } },
      },
    });
    if (!category) throw new NotFoundException('Category not found');

    const own = (category.attributeSchema as unknown as AttributeField[]) ?? [];
    const parentSchema = (category.parent?.attributeSchema as unknown as AttributeField[]) ?? [];

    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      // backward-compat: same field name; now returns the merged effective schema
      attributeSchema: resolveEffectiveSchema(own, parentSchema),
    };
  }
}
