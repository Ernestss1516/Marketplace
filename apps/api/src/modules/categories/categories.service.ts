import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  AttributeField,
  resolveEffectiveSchema,
  resolveEffectivePolicy,
  resolveEffectiveViews,
} from './category.types';

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
      const toAttrDef = (f: AttributeField) => ({ key: f.name, label: f.label, ...(f.unit !== undefined ? { unit: f.unit } : {}) });
      return {
        id: root.id,
        name: root.name,
        slug: root.slug,
        iconUrl: root.iconUrl,
        cardAttributes: rootSchema.filter((f) => f.cardAttribute).map(toAttrDef),
        // RÁFAGA 2 (vista ampliada): hasta 6 atributos relevantes para la card ancha,
        // independiente de cardAttributes (que sigue limitado a 2 para la card compacta).
        wideCardAttributes: rootSchema.filter((f) => f.wideCardAttribute).map(toAttrDef),
        allAttributes: rootSchema.map(toAttrDef),
        children: root.children.map((child) => {
          const childSchema = (child.attributeSchema as unknown as AttributeField[]) ?? [];
          const effective = resolveEffectiveSchema(childSchema, rootSchema);
          return {
            id: child.id,
            name: child.name,
            slug: child.slug,
            iconUrl: child.iconUrl,
            cardAttributes: effective.filter((f) => f.cardAttribute).map(toAttrDef),
            wideCardAttributes: effective.filter((f) => f.wideCardAttribute).map(toAttrDef),
            allAttributes: effective.map(toAttrDef),
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
        allowedListingType: true,
        allowedViews: true,
        defaultView: true,
        parent: {
          select: {
            attributeSchema: true,
            allowedListingType: true,
            allowedViews: true,
            defaultView: true,
          },
        },
      },
    });
    if (!category) throw new NotFoundException('Category not found');

    const own = (category.attributeSchema as unknown as AttributeField[]) ?? [];
    const parentSchema = (category.parent?.attributeSchema as unknown as AttributeField[]) ?? [];
    const effectiveSchema = resolveEffectiveSchema(own, parentSchema);

    const toAttrDef = (f: AttributeField) => ({ key: f.name, label: f.label, ...(f.unit !== undefined ? { unit: f.unit } : {}) });

    // RÁFAGA 2 — vistas: el padre resuelve primero contra `null` (2 niveles, sin abuelo),
    // luego el hijo resuelve contra el efectivo del padre. Mismo patrón que allowedListingType.
    const parentEffectiveViews = category.parent
      ? resolveEffectiveViews(
          { allowedViews: category.parent.allowedViews, defaultView: category.parent.defaultView },
          null,
        )
      : null;
    const effectiveViews = resolveEffectiveViews(
      { allowedViews: category.allowedViews, defaultView: category.defaultView },
      parentEffectiveViews,
    );

    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      // backward-compat: same field name; now returns the merged effective schema
      attributeSchema: effectiveSchema,
      // RÁFAGA 2 (vista ampliada en /[categoria])
      wideCardAttributes: effectiveSchema.filter((f) => f.wideCardAttribute).map(toAttrDef),
      // RÁFAGA 3 (wizard): política efectiva para que el wizard sepa si debe
      // preguntar el tipo (BOTH) o fijarlo sin preguntar (PRODUCT_ONLY/SERVICE_ONLY).
      allowedListingType: resolveEffectivePolicy(
        category.allowedListingType,
        category.parent?.allowedListingType ?? 'BOTH',
      ),
      // RÁFAGA 2: vistas efectivamente ofrecidas por esta categoría + su default.
      allowedViews: effectiveViews.allowedViews,
      defaultView: effectiveViews.defaultView,
    };
  }
}
