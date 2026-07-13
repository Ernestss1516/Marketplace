import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Alert, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { FilterableAttributesResolver } from '../search/filterable-attributes.resolver';
import { coerceAttributeValue } from '../search/search-query.parser';
import type { AttributeField } from '../categories/category.types';
import { alertToSearchParams } from './alert-to-search-params';
import { CreateAlertDto } from './dto/create-alert.dto';
import { UpdateAlertDto } from './dto/update-alert.dto';

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly searchService: SearchService,
    private readonly attributesResolver: FilterableAttributesResolver,
  ) {}

  async create(userId: string, dto: CreateAlertDto) {
    // AUDITORÍA DE FILTROS — mismo cross-category leak que RÁFAGA 1 arregló en
    // /search (SearchController), nunca replicado aquí: usar el mapa GLOBAL plano
    // dejaba crear una alerta con un atributo de OTRA categoría (p. ej. "rooms" en
    // una alerta de "coches") — 201 donde /search ya daba 400. La alerta quedaba
    // guardada con un criterio imposible que ningún anuncio real cumpliría jamás,
    // sin avisar al usuario. Misma función que /search (getAttributeTypesForCategory),
    // no una copia — así no puede volver a divergir.
    const attributeTypes = dto.categorySlug
      ? await this.attributesResolver.getAttributeTypesForCategory(dto.categorySlug)
      : await this.attributesResolver.getAttributeTypes();
    const attributes = this.coerceAttributes(dto.attributes, attributeTypes);

    const alert = await this.prisma.alert.create({
      data: {
        userId,
        name: dto.name,
        q: dto.q,
        categorySlug: dto.categorySlug,
        type: dto.type,
        condition: dto.condition,
        priceType: dto.priceType,
        minPrice: dto.minPrice,
        maxPrice: dto.maxPrice,
        province: dto.province,
        city: dto.city,
        attributes: Object.keys(attributes).length
          ? (attributes as Prisma.InputJsonValue)
          : undefined,
        lat: dto.lat,
        lng: dto.lng,
        radiusMeters: dto.radius != null ? Math.round(dto.radius * 1000) : undefined,
      },
    });

    const matches = await this.searchService.search(alertToSearchParams(alert));
    return { alert, matches };
  }

  async findByUser(userId: string, page: number, perPage: number) {
    const [items, total] = await Promise.all([
      this.prisma.alert.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.alert.count({ where: { userId } }),
    ]);
    return { items, total, page, perPage, pages: Math.ceil(total / perPage) };
  }

  /** Every field sent replaces the stored value — same contract as UpdateListingDto.
   * Scoped by (id, userId) in a single updateMany: an alert belonging to another
   * user behaves exactly like a non-existent one (404), no separate 403 that
   * would leak whether the id exists — mirrors the IDOR-safe pattern from
   * NotificationsService.markRead (B1). */
  async update(userId: string, id: string, dto: UpdateAlertDto): Promise<Alert> {
    const data: Prisma.AlertUpdateManyMutationInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.q !== undefined) data.q = dto.q;
    if (dto.categorySlug !== undefined) data.categorySlug = dto.categorySlug;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.condition !== undefined) data.condition = dto.condition;
    if (dto.priceType !== undefined) data.priceType = dto.priceType;
    if (dto.minPrice !== undefined) data.minPrice = dto.minPrice;
    if (dto.maxPrice !== undefined) data.maxPrice = dto.maxPrice;
    if (dto.province !== undefined) data.province = dto.province;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.lat !== undefined) data.lat = dto.lat;
    if (dto.lng !== undefined) data.lng = dto.lng;
    if (dto.radius !== undefined) data.radiusMeters = Math.round(dto.radius * 1000);
    if (dto.attributes !== undefined) {
      // Categoría EFECTIVA para el guard: la que llega en este mismo PATCH si la
      // toca, si no la ya guardada — un PATCH que solo toca `attributes` debe
      // seguir validando contra la categoría real de la alerta, no contra el mapa
      // global. Alerta inexistente/ajena → categorySlug queda undefined → cae al
      // mapa global, pero es inofensivo: el updateMany de abajo la resuelve a 404
      // de todas formas.
      const categorySlug =
        dto.categorySlug !== undefined
          ? dto.categorySlug
          : (await this.prisma.alert.findFirst({ where: { id, userId }, select: { categorySlug: true } }))
              ?.categorySlug;
      const attributeTypes = categorySlug
        ? await this.attributesResolver.getAttributeTypesForCategory(categorySlug)
        : await this.attributesResolver.getAttributeTypes();
      data.attributes = this.coerceAttributes(
        dto.attributes,
        attributeTypes,
      ) as Prisma.InputJsonValue;
    }

    const result = await this.prisma.alert.updateMany({ where: { id, userId }, data });
    if (result.count === 0) throw new NotFoundException('Alerta no encontrada');
    return this.prisma.alert.findUniqueOrThrow({ where: { id } });
  }

  /** Idempotent: scoped deleteMany matches 0 rows for an already-deleted or
   * not-owned alert, same "no-op either way" idempotency as Favorite.remove. */
  async remove(userId: string, id: string): Promise<void> {
    await this.prisma.alert.deleteMany({ where: { id, userId } });
  }

  async getMatches(userId: string, id: string) {
    const alert = await this.prisma.alert.findFirst({ where: { id, userId } });
    if (!alert) throw new NotFoundException('Alerta no encontrada');
    return this.searchService.search(alertToSearchParams(alert));
  }

  /** Mirrors the attribute half of parseSearchQuery (search-query.parser.ts):
   * raw string values from the URL, coerced to their real type against the
   * same category-derived type map Meilisearch filtering uses. Keeps "lo
   * guardado" and "lo que Meili filtra" in sync by construction. */
  private coerceAttributes(
    raw: Record<string, string> | undefined,
    attributeTypes: ReadonlyMap<string, AttributeField['type']>,
  ): Record<string, string | number | boolean> {
    const errors: string[] = [];
    const result: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(raw ?? {})) {
      const kind = attributeTypes.get(key);
      if (!kind) {
        errors.push(`property ${key} should not exist`);
        continue;
      }
      const coerced = coerceAttributeValue(kind, value, key, errors);
      if (coerced !== undefined) result[key] = coerced;
    }
    if (errors.length > 0) throw new UnprocessableEntityException(errors);
    return result;
  }
}
