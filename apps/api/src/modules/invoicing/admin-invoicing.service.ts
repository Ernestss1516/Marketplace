import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { R2Service } from '../../infra/r2/r2.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ListAdminInvoicesDto } from './dto/list-admin-invoices.dto';
import { UpdateFiscalIssuerDto } from './dto/update-fiscal-issuer.dto';

const FISCAL_ISSUER_SETTING_KEY = 'fiscalIssuer';

/**
 * Backoffice de facturas (RF.13 R5) — sobre todo LECTURA (el admin ve/descarga
 * TODAS las facturas) + configuración del emisor fiscal. Sin lógica fiscal nueva.
 */
@Injectable()
export class AdminInvoicingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly auditLog: AuditLogService,
  ) {}

  async listInvoices(dto: ListAdminInvoicesDto) {
    const { status, origin, periodKey, userId, userQuery, dateFrom, dateTo, page = 1, perPage = 25 } = dto;

    const where: Prisma.InvoiceWhereInput = {
      ...(status && { status }),
      ...(origin && { origin }),
      ...(periodKey && { periodKey }),
      ...(userId && { userId }),
      ...(userQuery && {
        user: {
          OR: [
            { email: { contains: userQuery, mode: 'insensitive' } },
            { name: { contains: userQuery, mode: 'insensitive' } },
          ],
        },
      }),
      ...((dateFrom ?? dateTo) && {
        issuedAt: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo) }),
        },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          number: true,
          status: true,
          origin: true,
          periodKey: true,
          issuedAt: true,
          currency: true,
          totalGross: true,
          receiverName: true,
          receiverTaxId: true,
          pdfKey: true,
          user: { select: { id: true, name: true, email: true } },
          _count: { select: { lines: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      items: items.map((inv) => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        origin: inv.origin,
        periodKey: inv.periodKey,
        issuedAt: inv.issuedAt,
        currency: inv.currency,
        totalGross: inv.totalGross.toString(),
        receiverName: inv.receiverName,
        receiverTaxId: inv.receiverTaxId,
        lineCount: inv._count.lines,
        hasPdf: Boolean(inv.pdfKey),
        user: inv.user,
      })),
      total,
      page,
      perPage,
    };
  }

  /** Detalle completo (líneas + emisor/receptor congelados + verifactu/providerRef). */
  async getInvoice(id: string) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { operationDate: 'asc' } },
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!inv) throw new NotFoundException('Factura no encontrada');

    return {
      ...inv,
      subtotalNet: inv.subtotalNet.toString(),
      totalTax: inv.totalTax.toString(),
      totalGross: inv.totalGross.toString(),
      lines: inv.lines.map((l) => ({
        ...l,
        amountNet: l.amountNet.toString(),
        taxAmount: l.taxAmount.toString(),
        taxRate: l.taxRate.toString(),
        amountGross: l.amountGross.toString(),
      })),
      hasPdf: Boolean(inv.pdfKey),
    };
  }

  /** Descarga admin: cualquier factura (sin scope de dueño, a diferencia de R3). */
  async getInvoicePdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw new NotFoundException('Factura no encontrada');
    if (!inv.pdfKey) throw new NotFoundException('La factura aún no tiene PDF');
    const buffer = await this.r2.download(inv.pdfKey);
    return { buffer, filename: `factura-${inv.number ?? inv.id}.pdf` };
  }

  async getFiscalIssuer() {
    const setting = await this.prisma.setting.findUnique({ where: { key: FISCAL_ISSUER_SETTING_KEY } });
    return { configured: !!setting, issuer: (setting?.value as Record<string, unknown>) ?? null };
  }

  /**
   * Guarda el emisor fiscal (validado en el DTO) + AuditLog. NO es retroactivo:
   * las facturas ya emitidas conservan su emisor congelado; solo las futuras usan
   * este valor.
   */
  async updateFiscalIssuer(dto: UpdateFiscalIssuerDto, actorId: string, ip: string) {
    const existing = await this.prisma.setting.findUnique({ where: { key: FISCAL_ISSUER_SETTING_KEY } });
    const before = (existing?.value ?? {}) as Prisma.InputJsonValue;

    const value: Prisma.InputJsonValue = {
      taxId: dto.taxId,
      fiscalName: dto.fiscalName,
      address: dto.address,
      city: dto.city,
      postalCode: dto.postalCode,
      province: dto.province,
      country: dto.country,
    };

    await this.prisma.setting.upsert({
      where: { key: FISCAL_ISSUER_SETTING_KEY },
      update: { value, updatedById: actorId },
      create: { key: FISCAL_ISSUER_SETTING_KEY, value, updatedById: actorId },
    });

    await this.auditLog.log({
      action: 'FISCAL_ISSUER_UPDATE',
      actorId,
      resourceType: 'Setting',
      resourceId: FISCAL_ISSUER_SETTING_KEY,
      before,
      after: value,
      ip,
    });

    return { issuer: value };
  }
}
