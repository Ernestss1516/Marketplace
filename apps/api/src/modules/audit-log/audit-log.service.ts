import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';

/**
 * Registra acciones administrativas sensibles en la tabla AuditLog.
 *
 * DECISIÓN: se llama EXPLÍCITAMENTE desde el service de dominio que realiza
 * la mutación, nunca desde un interceptor. El interceptor no tiene acceso al
 * estado de Prisma anterior a la mutación; usar uno haría imposible rellenar
 * el campo `before`, que es el principal valor del audit log.
 *
 * Patrón de uso (sin transacción activa):
 *   const before = { status: entity.status };
 *   await this.prisma.entity.update(...);
 *   await this.auditLog.log({ action: 'ENTITY_ACTION', ..., before, after: {...} });
 *
 * Patrón de uso (con transacción activa — auditoría atómica):
 *   await this.prisma.$transaction(async (tx) => {
 *     await tx.wallet.upsert(...);
 *     await tx.creditLedger.create(...);
 *     await this.auditLog.log({ ... }, tx);  // ← los tres o ninguno
 *   });
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(dto: CreateAuditLogDto, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({ data: dto });
  }

  /**
   * FICHA F1 — la primera LECTURA de la auditoría en todo el proyecto. Hasta
   * ahora este servicio sólo escribía: `AuditLog` acumulaba el historial de cada
   * recurso y no había ni un endpoint que lo devolviera.
   *
   * ACOTADA AL RECURSO, NO UN VISOR GENERAL, y la diferencia es de permisos, no
   * de comodidad. El historial de UN anuncio es material de moderación —quién lo
   * aprobó y cuándo— y la ficha es MODERATOR. Un explorador que cruce todos los
   * recursos enseña la actividad administrativa completa y es otra pantalla con
   * otro rol (ver docs/diseno-ficha-anuncio.md §6, D-4).
   *
   * NO DEVUELVE `ip`. Es el único campo del registro que no es historia del
   * recurso sino rastro de seguridad del ACTOR, y un moderador no lo necesita
   * para entender qué le pasó a un anuncio. Se queda dentro de la tabla, para
   * quien audite a las personas — que es la pantalla que este método no es.
   *
   * La consulta va por `@@index([resourceType, resourceId])`, que ya existía.
   */
  async listForResource(
    resourceType: string,
    resourceId: string,
    take = 30,
  ): Promise<AuditLogEntry[]> {
    return this.prisma.auditLog.findMany({
      where: { resourceType, resourceId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        action: true,
        before: true,
        after: true,
        createdAt: true,
        actor: { select: { id: true, name: true, slug: true } },
      },
    });
  }
}

/** Lo que ve la ficha de un movimiento de auditoría. Sin `ip` — ver arriba. */
export interface AuditLogEntry {
  id: string;
  action: string;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  createdAt: Date;
  actor: { id: string; name: string | null; slug: string | null } | null;
}
