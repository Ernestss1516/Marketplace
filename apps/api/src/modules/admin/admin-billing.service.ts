import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ListAdminTransactionsDto } from './dto/list-admin-transactions.dto';
import { ListAdminWalletsDto } from './dto/list-admin-wallets.dto';

@Injectable()
export class AdminBillingService {
  constructor(private readonly prisma: PrismaService) {}

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
}
