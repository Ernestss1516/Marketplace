import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationType, AlertMatchData } from './notification.types';

type DataByType = {
  ALERT_MATCH: AlertMatchData;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** No queue, no side effects — B3 calls this directly when an alert matches a new listing. */
  async createNotification<T extends NotificationType>(
    userId: string,
    type: T,
    data: DataByType[T],
  ): Promise<void> {
    await this.prisma.notification.create({
      data: { userId, type, data: data as unknown as Prisma.InputJsonValue },
    });
  }

  async findByUser(userId: string, page: number, perPage: number) {
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);
    return { items, total, page, perPage, pages: Math.ceil(total / perPage) };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, read: false } });
  }

  /** Scoped by userId, not just id — never trusts the :id param alone. Idempotent
   * either way: already-read or belonging to someone else both match 0 rows. */
  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, userId, read: false },
      data: { read: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });
  }
}
