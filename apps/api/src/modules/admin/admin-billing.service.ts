import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreditLedgerType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ListAdminTransactionsDto } from './dto/list-admin-transactions.dto';
import { ListAdminWalletsDto } from './dto/list-admin-wallets.dto';
import { CreditGrantDto } from './dto/credit-grant.dto';
import { UpdatePriceDto } from './dto/update-price.dto';
import { UpdateCreditPackDto } from './dto/update-credit-pack.dto';

@Injectable()
export class AdminBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async listTransactions(dto: ListAdminTransactionsDto) {
    const { gateway, status, userId, dateFrom, dateTo, page = 1, perPage = 25 } = dto;

    const where: Prisma.TransactionWhereInput = {
      ...(gateway && { gateway }),
      ...(status && { status }),
      ...(userId && { userId }),
      ...((dateFrom ?? dateTo) && {
        createdAt: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo) }),
        },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          gateway: true,
          status: true,
          amountGross: true,
          currency: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { items, total, page, perPage };
  }

  async listWallets(dto: ListAdminWalletsDto) {
    const { q, page = 1, perPage = 25 } = dto;

    const where: Prisma.WalletWhereInput = q
      ? {
          user: {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          },
        }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.wallet.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          balance: true,
          updatedAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.wallet.count({ where }),
    ]);

    return { items, total, page, perPage };
  }

  async getUserBillingDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const now = new Date();

    const [wallet, entitlements, transactions] = await this.prisma.$transaction([
      this.prisma.wallet.findUnique({
        where: { userId },
        select: {
          id: true,
          balance: true,
          updatedAt: true,
          entries: {
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
              id: true,
              type: true,
              amount: true,
              referenceType: true,
              referenceId: true,
              note: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.entitlement.findMany({
        where: {
          userId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          listingId: true,
          startsAt: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.transaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          gateway: true,
          status: true,
          amountGross: true,
          currency: true,
          createdAt: true,
        },
      }),
    ]);

    return { user, wallet, entitlements, transactions };
  }

  async grantCredits(
    userId: string,
    actorId: string,
    dto: CreditGrantDto,
    ip?: string,
  ): Promise<{ balance: number; creditedAmount: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const { newBalance } = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.wallet.findUnique({
        where: { userId },
        select: { balance: true },
      });
      const oldBalance = existing?.balance ?? 0;

      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: { userId, balance: dto.amount },
        update: { balance: { increment: dto.amount } },
        select: { id: true, balance: true },
      });

      await tx.creditLedger.create({
        data: {
          walletId: wallet.id,
          type: CreditLedgerType.ADMIN_CREDIT,
          amount: dto.amount,
          note: 'Créditos añadidos por el equipo',
          referenceType: 'User',
          referenceId: userId,
        },
      });

      // Audit log inside the transaction — all three writes are atomic.
      await this.auditLog.log(
        {
          action: 'ADMIN_CREDIT_GRANT',
          actorId,
          resourceType: 'Wallet',
          resourceId: userId,
          before: { balance: oldBalance } as Prisma.InputJsonValue,
          after: {
            balance: wallet.balance,
            amount: dto.amount,
            reason: dto.reason,
          } as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return { newBalance: wallet.balance };
    });

    return { balance: newBalance, creditedAmount: dto.amount };
  }

  // ===========================================================================
  // Monetización: precios en euros (Price) y créditos por pack (CreditPack)
  // ===========================================================================

  /**
   * Lista los Price editables desde el backoffice: destacado por tarjeta
   * (durationDays != null) y packs de créditos (creditPackId != null). Excluye
   * de raíz los Price recurrentes de Stripe (Plan Pro), que se gestionan aparte.
   */
  async listPrices() {
    const prices = await this.prisma.price.findMany({
      where: {
        OR: [{ durationDays: { not: null } }, { creditPackId: { not: null } }],
      },
      include: {
        product: { select: { name: true } },
        creditPack: {
          select: { id: true, name: true, creditAmount: true, active: true, highlightBumps: true },
        },
      },
      orderBy: [{ product: { name: 'asc' } }, { durationDays: 'asc' }],
    });

    return prices.map((price) => ({
      id: price.id,
      label: price.creditPack ? price.creditPack.name : `${price.product.name} — ${price.durationDays} días`,
      amount: price.amount,
      currency: price.currency,
      durationDays: price.durationDays,
      active: price.active,
      creditPackId: price.creditPack?.id ?? null,
      creditAmount: price.creditPack?.creditAmount ?? null,
      highlightBumps: price.creditPack?.highlightBumps ?? null,
    }));
  }

  private assertNotStripePrice(price: { interval: string | null; gatewayPriceId: string | null }) {
    if (price.interval != null || price.gatewayPriceId != null) {
      throw new BadRequestException('Los precios de Stripe se gestionan aparte, no desde aquí.');
    }
  }

  async updatePrice(id: string, actorId: string, dto: UpdatePriceDto, ip?: string) {
    const existing = await this.prisma.price.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Price no encontrado');
    this.assertNotStripePrice(existing);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.price.update({
        where: { id },
        data: { amount: dto.amount },
      });

      await this.auditLog.log(
        {
          action: 'PRICE_UPDATE',
          actorId,
          resourceType: 'Price',
          resourceId: id,
          before: { amount: existing.amount.toString() } as Prisma.InputJsonValue,
          after: { amount: dto.amount } as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return updated;
    });
  }

  async updateCreditPackAmount(
    creditPackId: string,
    actorId: string,
    dto: UpdateCreditPackDto,
    ip?: string,
  ) {
    const existing = await this.prisma.creditPack.findUnique({ where: { id: creditPackId } });
    if (!existing) throw new NotFoundException('Credit pack no encontrado');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.creditPack.update({
        where: { id: creditPackId },
        data: {
          creditAmount: dto.creditAmount,
          ...(dto.highlightBumps !== undefined && { highlightBumps: dto.highlightBumps }),
        },
      });

      await this.auditLog.log(
        {
          action: 'CREDIT_PACK_UPDATE',
          actorId,
          resourceType: 'CreditPack',
          resourceId: creditPackId,
          before: {
            creditAmount: existing.creditAmount,
            highlightBumps: existing.highlightBumps,
          } as Prisma.InputJsonValue,
          after: {
            creditAmount: dto.creditAmount,
            highlightBumps: updated.highlightBumps,
          } as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return updated;
    });
  }
}
