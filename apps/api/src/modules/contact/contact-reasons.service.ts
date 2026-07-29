import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContactReason, ContactReasonScope, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateContactReasonDto } from './dto/create-contact-reason.dto';
import { UpdateContactReasonDto } from './dto/update-contact-reason.dto';
import { ReorderContactReasonsDto } from './dto/reorder-contact-reasons.dto';

/**
 * Motivos de contacto configurables por el admin (RC.2) — molde
 * BannersService/SponsoredAdsService: AuditLog dentro de $transaction, sin
 * DELETE (solo desactivación). Único invariante propio: nunca puede quedar
 * cero motivos activos (el formulario público se quedaría sin opciones).
 */
@Injectable()
export class ContactReasonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Motivos activos de un ÁMBITO, ordenados. Dos consumidores:
   *   · `GET /contacto/motivos` (público)  → PUBLIC + BOTH
   *   · `GET /tickets/topics`  (autenticado) → TICKET + BOTH
   *
   * El filtro por scope FALTABA: la columna se añadió en R1 de atención al
   * usuario pero este método seguía devolviendo todos los activos, así que el
   * formulario público habría acabado ofreciendo motivos de ámbito TICKET en
   * cuanto se creara el primero. No había mordido porque hasta ahora todos los
   * motivos eran PUBLIC (el `@default`). Cerrado aquí, en el único sitio que
   * lee la lista, en vez de en cada llamante.
   */
  async listActive(scopes: ContactReasonScope[]): Promise<Pick<ContactReason, 'id' | 'nombre'>[]> {
    return this.prisma.contactReason.findMany({
      where: { activo: true, scope: { in: scopes } },
      orderBy: { orden: 'asc' },
      select: { id: true, nombre: true },
    });
  }

  /** GET /admin/contact-reasons — TODOS (incluidos inactivos: el filtro del
   * listado de mensajes y el propio panel de gestión los necesitan; hay
   * mensajes históricos con motivos ya desactivados). */
  async listAll(): Promise<ContactReason[]> {
    return this.prisma.contactReason.findMany({ orderBy: { orden: 'asc' } });
  }

  async create(dto: CreateContactReasonDto, actorId: string, ip?: string): Promise<ContactReason> {
    const maxOrden = await this.prisma.contactReason.aggregate({ _max: { orden: true } });
    const orden = (maxOrden._max.orden ?? -1) + 1;

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.contactReason.create({
        data: { nombre: dto.nombre, orden },
      });

      await this.auditLog.log(
        {
          action: 'CONTACT_REASON_CREATE',
          actorId,
          resourceType: 'ContactReason',
          resourceId: created.id,
          after: this.snapshot(created) as unknown as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return created;
    });
  }

  async update(
    id: string,
    dto: UpdateContactReasonDto,
    actorId: string,
    ip?: string,
  ): Promise<ContactReason> {
    const existing = await this.prisma.contactReason.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Motivo no encontrado');

    if (dto.activo === false && existing.activo) {
      const otherActiveCount = await this.prisma.contactReason.count({
        where: { activo: true, id: { not: id } },
      });
      if (otherActiveCount === 0) {
        throw new BadRequestException('Debe quedar al menos un motivo activo');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contactReason.update({
        where: { id },
        data: {
          ...(dto.nombre !== undefined && { nombre: dto.nombre }),
          ...(dto.activo !== undefined && { activo: dto.activo }),
        },
      });

      let action = 'CONTACT_REASON_EDIT';
      if (dto.activo === true && !existing.activo) action = 'CONTACT_REASON_ACTIVATE';
      else if (dto.activo === false && existing.activo) action = 'CONTACT_REASON_DEACTIVATE';

      await this.auditLog.log(
        {
          action,
          actorId,
          resourceType: 'ContactReason',
          resourceId: id,
          before: this.snapshot(existing) as unknown as Prisma.InputJsonValue,
          after: this.snapshot(updated) as unknown as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return updated;
    });
  }

  async reorder(dto: ReorderContactReasonsDto, actorId: string, ip?: string): Promise<void> {
    await this.prisma.$transaction([
      ...dto.items.map(({ id, orden }) =>
        this.prisma.contactReason.update({ where: { id }, data: { orden } }),
      ),
      this.prisma.auditLog.create({
        data: {
          action: 'CONTACT_REASON_REORDER',
          actorId,
          resourceType: 'ContactReason',
          resourceId: 'batch',
          after: dto.items as unknown as Prisma.InputJsonValue,
          ip,
        },
      }),
    ]);
  }

  private snapshot(reason: ContactReason) {
    return { nombre: reason.nombre, orden: reason.orden, activo: reason.activo };
  }
}
