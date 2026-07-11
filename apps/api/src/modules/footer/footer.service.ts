import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FooterItemType, Prisma, PostStatus, PostType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RevalidateService } from '../../common/revalidate/revalidate.service';
import { isAbsoluteHttpUrl } from '../../common/validators/safe-url';
import { CreateFooterColumnDto } from './dto/create-footer-column.dto';
import { UpdateFooterColumnDto } from './dto/update-footer-column.dto';
import { ReorderFooterColumnsDto } from './dto/reorder-footer-columns.dto';
import { CreateFooterItemDto } from './dto/create-footer-item.dto';
import { UpdateFooterItemDto } from './dto/update-footer-item.dto';
import { ReorderFooterItemsDto } from './dto/reorder-footer-items.dto';

const ITEM_WITH_PAGE_STATUS = {
  select: { id: true, title: true, slug: true, status: true },
} as const;

@Injectable()
export class FooterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly revalidateService: RevalidateService,
  ) {}

  // ── Public ───────────────────────────────────────────────────────────────

  // Resuelto server-side: PAGE → /paginas/{slug} (omitido si la página no está
  // PUBLISHED — mismo comportamiento implícito que el footer anterior basado
  // en Post); INTERNAL/EXTERNAL → url tal cual. Columnas que se quedan sin
  // ningún ítem visible (todas sus páginas en DRAFT) se omiten enteras, no se
  // renderiza un encabezado huérfano.
  async listPublicNav(): Promise<
    Array<{ name: string | null; items: Array<{ label: string; href: string; external: boolean }> }>
  > {
    const columns = await this.prisma.footerColumn.findMany({
      orderBy: { order: 'asc' },
      include: {
        items: {
          orderBy: { order: 'asc' },
          include: { page: { select: { slug: true, status: true } } },
        },
      },
    });

    return columns
      .map((column) => ({
        name: column.name,
        items: column.items
          .filter((item) => item.type !== FooterItemType.PAGE || item.page?.status === PostStatus.PUBLISHED)
          .map((item) => ({
            label: item.label,
            href: item.type === FooterItemType.PAGE ? `/paginas/${item.page!.slug}` : item.url!,
            external: item.type === FooterItemType.EXTERNAL,
          })),
      }))
      .filter((column) => column.items.length > 0);
  }

  // ── Admin: lectura ───────────────────────────────────────────────────────

  // Estructura completa sin filtrar — a diferencia de listPublicNav, incluye
  // columnas/ítems vacíos y el status de la página enlazada (para que la UI
  // pinte el badge "en borrador — no se muestra").
  adminListStructure() {
    return this.prisma.footerColumn.findMany({
      orderBy: { order: 'asc' },
      include: {
        items: {
          orderBy: { order: 'asc' },
          include: { page: ITEM_WITH_PAGE_STATUS },
        },
      },
    });
  }

  // ── Admin: columnas ──────────────────────────────────────────────────────

  async createColumn(dto: CreateFooterColumnDto, actorId: string, ip?: string) {
    const created = await this.prisma.footerColumn.create({
      data: { name: dto.name ?? null, order: dto.order ?? 0 },
    });

    await this.auditLog.log({
      action: 'FOOTER_COLUMN_CREATE',
      actorId,
      resourceType: 'FooterColumn',
      resourceId: created.id,
      after: { name: created.name, order: created.order },
      ip,
    });

    this.revalidateService.revalidateTag('footer-nav');
    return created;
  }

  async updateColumn(id: string, dto: UpdateFooterColumnDto, actorId: string, ip?: string) {
    const column = await this.findColumnOrThrow(id);
    const before = { name: column.name, order: column.order };

    const updated = await this.prisma.footerColumn.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
    });

    await this.auditLog.log({
      action: 'FOOTER_COLUMN_UPDATE',
      actorId,
      resourceType: 'FooterColumn',
      resourceId: id,
      before,
      after: { name: updated.name, order: updated.order },
      ip,
    });

    this.revalidateService.revalidateTag('footer-nav');
    return updated;
  }

  // Cascade explícito a sus ítems (FooterItem.column, onDelete: Cascade) — es
  // una acción consciente del admin, no un efecto secundario oculto: la UI
  // muestra cuántos ítems se van con la columna ANTES de confirmar, usando la
  // estructura que ya tiene cargada (adminListStructure), sin necesidad de un
  // precheck aquí como el de deleteCategory (no hay un tercero externo que
  // pueda sorprenderse — el propio admin es quien pidió borrar la columna).
  async deleteColumn(id: string, actorId: string, ip?: string) {
    const column = await this.findColumnOrThrow(id);
    const itemCount = await this.prisma.footerItem.count({ where: { columnId: id } });

    await this.prisma.footerColumn.delete({ where: { id } });

    await this.auditLog.log({
      action: 'FOOTER_COLUMN_DELETE',
      actorId,
      resourceType: 'FooterColumn',
      resourceId: id,
      before: { name: column.name, itemCount },
      ip,
    });

    this.revalidateService.revalidateTag('footer-nav');
  }

  async reorderColumns(dto: ReorderFooterColumnsDto, actorId: string, ip?: string) {
    await this.prisma.$transaction(
      dto.items.map(({ id, order }) => this.prisma.footerColumn.update({ where: { id }, data: { order } })),
    );

    await this.auditLog.log({
      action: 'FOOTER_COLUMN_REORDER',
      actorId,
      resourceType: 'FooterColumn',
      resourceId: 'batch',
      after: { items: dto.items as unknown as Prisma.InputJsonValue },
      ip,
    });

    this.revalidateService.revalidateTag('footer-nav');
  }

  // ── Admin: ítems ─────────────────────────────────────────────────────────

  async createItem(dto: CreateFooterItemDto, actorId: string, ip?: string) {
    this.assertItemDestination(dto.type, dto.pageId, dto.url);
    if (dto.type === FooterItemType.PAGE) {
      await this.assertPageDestination(dto.pageId!);
    }

    const created = await this.prisma.footerItem.create({
      data: {
        columnId: dto.columnId,
        label: dto.label,
        order: dto.order ?? 0,
        type: dto.type,
        pageId: dto.type === FooterItemType.PAGE ? dto.pageId : null,
        url: dto.type === FooterItemType.PAGE ? null : dto.url,
      },
    });

    await this.auditLog.log({
      action: 'FOOTER_ITEM_CREATE',
      actorId,
      resourceType: 'FooterItem',
      resourceId: created.id,
      after: { label: created.label, type: created.type, columnId: created.columnId },
      ip,
    });

    this.revalidateService.revalidateTag('footer-nav');
    return created;
  }

  // "Mover de columna" = incluir columnId aquí — no hay endpoint ni drag&drop
  // aparte. Tocar type/pageId/url exige mandar la combinación COMPLETA del
  // destino resuelto en el mismo payload (no se mezcla con lo ya guardado) —
  // el formulario de edición del admin siempre envía el destino entero de una
  // vez, así que esto nunca es una limitación real, solo evita la ambigüedad
  // de "¿qué campo viejo sigue vigente?" en un update parcial.
  async updateItem(id: string, dto: UpdateFooterItemDto, actorId: string, ip?: string) {
    const item = await this.findItemOrThrow(id);
    const before = { label: item.label, type: item.type, columnId: item.columnId, order: item.order };

    const touchesDestination = dto.type !== undefined || dto.pageId !== undefined || dto.url !== undefined;
    const resolvedType = dto.type ?? item.type;

    if (touchesDestination) {
      this.assertItemDestination(resolvedType, dto.pageId, dto.url);
      if (resolvedType === FooterItemType.PAGE) {
        await this.assertPageDestination(dto.pageId!);
      }
    }

    const updated = await this.prisma.footerItem.update({
      where: { id },
      data: {
        ...(dto.columnId !== undefined && { columnId: dto.columnId }),
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(touchesDestination && {
          type: resolvedType,
          pageId: resolvedType === FooterItemType.PAGE ? dto.pageId : null,
          url: resolvedType === FooterItemType.PAGE ? null : dto.url,
        }),
      },
    });

    await this.auditLog.log({
      action: 'FOOTER_ITEM_UPDATE',
      actorId,
      resourceType: 'FooterItem',
      resourceId: id,
      before,
      after: { label: updated.label, type: updated.type, columnId: updated.columnId, order: updated.order },
      ip,
    });

    this.revalidateService.revalidateTag('footer-nav');
    return updated;
  }

  async deleteItem(id: string, actorId: string, ip?: string) {
    const item = await this.findItemOrThrow(id);

    await this.prisma.footerItem.delete({ where: { id } });

    await this.auditLog.log({
      action: 'FOOTER_ITEM_DELETE',
      actorId,
      resourceType: 'FooterItem',
      resourceId: id,
      before: { label: item.label, type: item.type, columnId: item.columnId },
      ip,
    });

    this.revalidateService.revalidateTag('footer-nav');
  }

  async reorderItems(dto: ReorderFooterItemsDto, actorId: string, ip?: string) {
    await this.prisma.$transaction(
      dto.items.map(({ id, order }) => this.prisma.footerItem.update({ where: { id }, data: { order } })),
    );

    await this.auditLog.log({
      action: 'FOOTER_ITEM_REORDER',
      actorId,
      resourceType: 'FooterItem',
      resourceId: 'batch',
      after: { items: dto.items as unknown as Prisma.InputJsonValue },
      ip,
    });

    this.revalidateService.revalidateTag('footer-nav');
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async findColumnOrThrow(id: string) {
    const column = await this.prisma.footerColumn.findUnique({ where: { id } });
    if (!column) throw new NotFoundException('Columna del footer no encontrada');
    return column;
  }

  private async findItemOrThrow(id: string) {
    const item = await this.prisma.footerItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Ítem del footer no encontrado');
    return item;
  }

  // Destino discriminado: PAGE → pageId obligatorio + url ausente; INTERNAL →
  // url obligatorio empezando por "/" + pageId ausente; EXTERNAL → url
  // obligatorio como URL absoluta + pageId ausente. Vive en el servicio, no en
  // el DTO — mismo estilo que Post.assertFooterFieldsAllowed.
  private assertItemDestination(type: FooterItemType, pageId?: string, url?: string): void {
    if (type === FooterItemType.PAGE) {
      if (!pageId) throw new BadRequestException('pageId es obligatorio cuando type=PAGE');
      if (url) throw new BadRequestException('url debe ir vacío cuando type=PAGE');
      return;
    }

    if (type === FooterItemType.INTERNAL) {
      if (!url) throw new BadRequestException('url es obligatorio cuando type=INTERNAL');
      if (!url.startsWith('/')) throw new BadRequestException('Una ruta interna debe empezar por "/"');
      if (pageId) throw new BadRequestException('pageId debe ir vacío cuando type=INTERNAL');
      return;
    }

    // EXTERNAL
    if (!url) throw new BadRequestException('url es obligatorio cuando type=EXTERNAL');
    if (!isAbsoluteHttpUrl(url)) {
      throw new BadRequestException('url debe ser una URL absoluta (http/https) cuando type=EXTERNAL');
    }
    if (pageId) throw new BadRequestException('pageId debe ir vacío cuando type=EXTERNAL');
  }

  // El destino PAGE debe apuntar a un Post real de type=PAGE — nunca a un
  // POST de blog (namespace de URL distinto: /paginas/ vs /blog/) ni a un id
  // inexistente (sin este chequeo, el INSERT chocaría con FooterItem.page,
  // onDelete: Restrict, como un 500 sin controlar en vez de este 404/400).
  private async assertPageDestination(pageId: string): Promise<void> {
    const page = await this.prisma.post.findUnique({ where: { id: pageId }, select: { type: true } });
    if (!page) throw new NotFoundException('Página no encontrada');
    if (page.type !== PostType.PAGE) {
      throw new BadRequestException('pageId debe apuntar a una página informativa (type=PAGE), no a un post de blog');
    }
  }
}
