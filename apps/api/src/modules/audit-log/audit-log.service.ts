import { Injectable } from '@nestjs/common';
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
 * Patrón de uso:
 *   const before = { status: entity.status };
 *   await this.prisma.entity.update(...);
 *   await this.auditLog.log({ action: 'ENTITY_ACTION', ..., before, after: {...} });
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(dto: CreateAuditLogDto): Promise<void> {
    await this.prisma.auditLog.create({ data: dto });
  }
}
