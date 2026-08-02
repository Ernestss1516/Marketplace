import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { isP2002 } from '../../common/prisma/is-p2002';
import { DEFAULT_MAX_TAGS_PER_LISTING, resolveEffectiveTags, type TagRef } from './tag.types';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { ReorderTagsDto } from './dto/reorder-tags.dto';
import { SetCategoryTagsDto } from './dto/set-category-tags.dto';
import { ListTagsDto } from './dto/list-tags.dto';

/** Caché de los tags efectivos por slug de categoría. Molde SponsoredAdsService: prefijo
 *  propio, TTL corto e invalidación explícita al tocar la config. */
const CACHE_PREFIX = 'category-tags:';
const CACHE_TTL_SECONDS = 300;

/** Campos que viajan al público. `orden`/`activo` son de administración. */
const TAG_REF_SELECT = { id: true, slug: true, name: true } as const;

/** B2 — la clave del tope. Debe coincidir con SETTING_KEYS en admin.service.ts. */
const MAX_TAGS_SETTING_KEY = 'maxTagsPerListing';

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ===========================================================================
  // Público
  // ===========================================================================

  /**
   * Tags EFECTIVOS de una categoría: los suyos más los de su padre, activos, con los
   * propios primero (ver `resolveEffectiveTags`).
   *
   * Una sola consulta para las dos categorías —la propia y su padre— en vez de dos
   * viajes: el `where` de CategoryTag acepta ambas a la vez y luego se reparten en
   * memoria.
   */
  async effectiveTagsForCategory(categorySlug: string): Promise<TagRef[]> {
    const cacheKey = CACHE_PREFIX + categorySlug;
    const cached = await this.redis.client.get(cacheKey);
    if (cached) return JSON.parse(cached) as TagRef[];

    const category = await this.prisma.category.findUnique({
      where: { slug: categorySlug },
      select: { id: true, parentId: true },
    });
    if (!category) throw new NotFoundException('Category not found');

    const ids = [category.id, ...(category.parentId ? [category.parentId] : [])];
    const filas = await this.prisma.categoryTag.findMany({
      where: { categoryId: { in: ids }, tag: { activo: true } },
      orderBy: [{ orden: 'asc' }, { tag: { name: 'asc' } }],
      select: { categoryId: true, tag: { select: TAG_REF_SELECT } },
    });

    const efectivos = resolveEffectiveTags(
      filas.filter((f) => f.categoryId === category.id).map((f) => f.tag),
      filas.filter((f) => f.categoryId !== category.id).map((f) => f.tag),
    );

    await this.redis.client.set(cacheKey, JSON.stringify(efectivos), 'EX', CACHE_TTL_SECONDS);
    return efectivos;
  }

  /**
   * B2 — tope de tags por anuncio. Molde exacto de `TicketsService.getReopenWindowDays`:
   * un valor no numérico o <= 0 cae al default en vez de romper, y "sin fila" es un
   * estado válido (la clave no se siembra).
   */
  async getMaxTagsPerListing(): Promise<number> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: MAX_TAGS_SETTING_KEY },
    });
    const value = Number(setting?.value);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_TAGS_PER_LISTING;
  }

  /**
   * B2 — valida los slugs que manda el wizard y los traduce a ids. Es el punto donde
   * `maxTagsPerListing` POR FIN se usa: B1 lo definió, aquí se aplica.
   *
   * Dos reglas, las dos con 422 (regla de negocio incumplida, no petición malformada —
   * mismo criterio que `validateAttributeValues`):
   *  1. Cada slug debe estar en el set EFECTIVO de la categoría (propios + heredados,
   *     solo activos). Un tag del catálogo que la categoría no ofrece es tan inválido
   *     como uno inexistente: el usuario no podía verlo en el wizard.
   *  2. `tags.length <= max`, con el tope en el mensaje para que el cliente pueda
   *     decirle al usuario cuántos sobran.
   *
   * El orden lo fija el set efectivo, no el array de entrada: así dos anuncios con los
   * mismos tags los guardan igual, y los propios de la categoría van antes que los
   * heredados como en todo lo demás.
   */
  async resolveTagsForListing(slugs: string[], categorySlug: string): Promise<string[]> {
    // Duplicados: el mismo tag dos veces no es "dos tags", y sin deduplicar
    // reventaría la clave compuesta de ListingTag con un P2002 opaco.
    const pedidos = [...new Set(slugs)];
    if (pedidos.length === 0) return [];

    const efectivos = await this.effectiveTagsForCategory(categorySlug);
    const porSlug = new Map(efectivos.map((t) => [t.slug, t]));

    const ajenos = pedidos.filter((s) => !porSlug.has(s));
    if (ajenos.length > 0) {
      throw new UnprocessableEntityException(
        `Etiquetas no válidas para esta categoría: ${ajenos.join(', ')}`,
      );
    }

    const max = await this.getMaxTagsPerListing();
    if (pedidos.length > max) {
      throw new UnprocessableEntityException(
        `Un anuncio admite como máximo ${max} etiqueta(s); se han enviado ${pedidos.length}.`,
      );
    }

    const seleccionados = new Set(pedidos);
    return efectivos.filter((t) => seleccionados.has(t.slug)).map((t) => t.id);
  }

  /**
   * B2 — al MOVER un anuncio de categoría se descartan los tags que la nueva no ofrece,
   * en silencio y sin rechazar la edición. El usuario no eligió romperlos: cambió de
   * categoría, y los tags son propiedad de la categoría, no del anuncio.
   *
   * NO se aplica el tope aquí a propósito — es una poda, nunca puede aumentar el
   * número de tags, así que un anuncio con más tags que el tope actual (grandfathering)
   * sobrevive a un cambio de categoría igual que sobrevive a cualquier otra edición
   * que no toque `tags`.
   */
  async pruneTagsForCategory(tagIds: string[], categorySlug: string): Promise<string[]> {
    if (tagIds.length === 0) return [];
    const efectivos = await this.effectiveTagsForCategory(categorySlug);
    const validos = new Set(efectivos.map((t) => t.id));
    return efectivos.filter((t) => validos.has(t.id) && tagIds.includes(t.id)).map((t) => t.id);
  }

  // ===========================================================================
  // Admin — catálogo global
  // ===========================================================================

  async list(query: ListTagsDto) {
    const { q, page = 1, perPage = 50 } = query;
    // Se listan ACTIVOS E INACTIVOS: el admin necesita ver lo que desactivó para poder
    // reactivarlo. El filtro por activo es cosa de quien los OFRECE, no de quien los
    // administra.
    const where: Prisma.TagWhereInput = q
      ? { name: { contains: q, mode: 'insensitive' } }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.tag.findMany({
        where,
        orderBy: [{ orden: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.tag.count({ where }),
    ]);

    return { items, total, page, perPage };
  }

  async create(dto: CreateTagDto, actorId: string, ip?: string) {
    const slug = dto.slug?.trim() || slugify(dto.name);
    if (!slug) {
      throw new BadRequestException(
        'No se pudo derivar un slug del nombre. Indica uno explícitamente.',
      );
    }

    try {
      const created = await this.prisma.tag.create({
        data: { name: dto.name.trim(), slug, orden: dto.orden ?? 0 },
      });

      await this.auditLog.log({
        action: 'TAG_CREATE',
        actorId,
        resourceType: 'Tag',
        resourceId: created.id,
        after: { name: created.name, slug: created.slug },
        ip,
      });

      return created;
    } catch (e) {
      if (isP2002(e)) {
        // El slug es la identidad pública del tag (URL + índice), así que un choque no
        // se puede resolver solo: se dice cuál es y se deja elegir.
        throw new ConflictException(`Ya existe un tag con el slug "${slug}"`);
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateTagDto, actorId: string, ip?: string) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('Tag no encontrado');

    const updated = await this.prisma.tag.update({
      where: { id },
      // `slug` NO está en el DTO a propósito: es lo que viaja en la URL de filtro y lo
      // que se indexa. Cambiarlo exigiría redirigir esas URLs y reindexar todos los
      // anuncios que lo llevan; renombrar se hace con `name`.
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.orden !== undefined && { orden: dto.orden }),
        ...(dto.activo !== undefined && { activo: dto.activo }),
      },
    });

    await this.auditLog.log({
      action: 'TAG_EDIT',
      actorId,
      resourceType: 'Tag',
      resourceId: id,
      before: { name: tag.name, orden: tag.orden, activo: tag.activo },
      after: { name: updated.name, orden: updated.orden, activo: updated.activo },
      ip,
    });

    // Desactivar (o renombrar) cambia lo que se ofrece: la caché de CUALQUIER categoría
    // puede contenerlo, así que se invalida entera. Es un evento raro y el TTL es corto.
    await this.invalidateAllCategoryTagCaches();

    return updated;
  }

  async reorder(dto: ReorderTagsDto, actorId: string, ip?: string) {
    await this.prisma.$transaction(
      dto.items.map(({ id, orden }) => this.prisma.tag.update({ where: { id }, data: { orden } })),
    );

    await this.auditLog.log({
      action: 'TAG_REORDER',
      actorId,
      resourceType: 'Tag',
      resourceId: 'batch',
      after: { items: dto.items as unknown as Prisma.InputJsonValue },
      ip,
    });

    await this.invalidateAllCategoryTagCaches();
  }

  /**
   * Uso de un tag. Alimenta el aviso ANTES de desactivar: desactivar se PERMITE
   * (los anuncios lo conservan), pero el admin merece saber a cuántos afecta.
   * Molde `getAttributeUsage`.
   */
  async usage(id: string): Promise<{ listingCount: number; categoryCount: number }> {
    const tag = await this.prisma.tag.findUnique({ where: { id }, select: { id: true } });
    if (!tag) throw new NotFoundException('Tag no encontrado');

    const [listingCount, categoryCount] = await this.prisma.$transaction([
      this.prisma.listingTag.count({ where: { tagId: id } }),
      this.prisma.categoryTag.count({ where: { tagId: id } }),
    ]);

    return { listingCount, categoryCount };
  }

  // ===========================================================================
  // Admin — asignación por categoría
  // ===========================================================================

  /**
   * Lo que el panel de la categoría necesita: sus tags PROPIOS (editables) y los que le
   * llegan del padre (SOLO LECTURA). Mismo reparto que `AttributeSchemaEditor` hace con
   * los atributos heredados: se ven, para saber con qué se cuenta, pero no se tocan
   * desde aquí — se tocan en el padre.
   */
  async categoryTags(categoryId: string): Promise<{ own: TagRef[]; inherited: TagRef[] }> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, parentId: true },
    });
    if (!category) throw new NotFoundException('Categoría no encontrada');

    const own = await this.tagsOfCategory(category.id);
    const inherited = category.parentId ? await this.tagsOfCategory(category.parentId) : [];

    // Un tag asignado a la vez al padre y a la hija es "propio": el admin lo puede
    // quitar desde aquí. Se descuenta de heredados para no mostrarlo dos veces.
    const propios = new Set(own.map((t) => t.id));
    return { own, inherited: inherited.filter((t) => !propios.has(t.id)) };
  }

  /**
   * Reemplaza el set PROPIO de la categoría. No toca los heredados: son del padre y
   * desde aquí solo se ven.
   *
   * `deleteMany` + `createMany` en UNA transacción, no un diff campo a campo: el cliente
   * manda el estado final que quiere y el resultado es ese, sin depender de qué había
   * antes ni de que dos ediciones simultáneas se pisen a medias.
   */
  async setCategoryTags(categoryId: string, dto: SetCategoryTagsDto, actorId: string, ip?: string) {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, slug: true, children: { select: { slug: true } } },
    });
    if (!category) throw new NotFoundException('Categoría no encontrada');

    const tagIds = [...new Set(dto.tagIds)];
    if (tagIds.length > 0) {
      const existentes = await this.prisma.tag.count({ where: { id: { in: tagIds } } });
      if (existentes !== tagIds.length) {
        throw new BadRequestException('Algún tag no existe');
      }
    }

    await this.prisma.$transaction([
      this.prisma.categoryTag.deleteMany({ where: { categoryId } }),
      ...(tagIds.length
        ? [
            this.prisma.categoryTag.createMany({
              data: tagIds.map((tagId, i) => ({ categoryId, tagId, orden: i })),
            }),
          ]
        : []),
    ]);

    await this.auditLog.log({
      action: 'CATEGORY_TAGS_SET',
      actorId,
      resourceType: 'Category',
      resourceId: categoryId,
      after: { tagIds: tagIds as unknown as Prisma.InputJsonValue },
      ip,
    });

    // Cambiar los tags de una categoría cambia también los EFECTIVOS de sus hijas
    // (los heredan), así que se invalidan las dos cosas — mismo razonamiento que
    // `invalidateCacheForCategory` de SponsoredAdsService.
    const slugs = [category.slug, ...category.children.map((c) => c.slug)];
    await this.redis.client.del(...slugs.map((s) => CACHE_PREFIX + s));

    return this.categoryTags(categoryId);
  }

  // ===========================================================================
  // Interno
  // ===========================================================================

  private async tagsOfCategory(categoryId: string): Promise<TagRef[]> {
    const filas = await this.prisma.categoryTag.findMany({
      where: { categoryId },
      orderBy: [{ orden: 'asc' }],
      select: { tag: { select: TAG_REF_SELECT } },
    });
    return filas.map((f) => f.tag);
  }

  /** Editar el catálogo global (renombrar, desactivar, reordenar) puede afectar a
   *  cualquier categoría, así que no hay un subconjunto que invalidar: se borran todas
   *  las claves del prefijo. Son operaciones de administración, no de la ruta caliente. */
  private async invalidateAllCategoryTagCaches(): Promise<void> {
    const keys = await this.redis.client.keys(`${CACHE_PREFIX}*`);
    if (keys.length) await this.redis.client.del(...keys);
  }
}

/** Molde del slugify de `AuthService.generateUniqueSlug`: minúsculas, sin acentos, solo
 *  `[a-z0-9-]`. Aquí no hay desambiguación numérica: un choque de slug es un 409 que el
 *  admin resuelve, no algo que el sistema deba decidir por él. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
