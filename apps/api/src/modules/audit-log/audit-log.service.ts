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
}
