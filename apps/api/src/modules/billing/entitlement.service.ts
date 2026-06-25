import { Injectable } from '@nestjs/common';
import { EntitlementType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class EntitlementService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns true if the user has an active PRO_SUBSCRIPTION entitlement.
   * Only reads the Entitlement table — never calls Stripe.
   */
  async isProActive(userId: string): Promise<boolean> {
    const now = new Date();
    const row = await this.prisma.entitlement.findFirst({
      where: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Returns true if the listing has an active FEATURED_LISTING entitlement.
   * Only reads the Entitlement table — never calls Stripe.
   */
  async isFeaturedActive(listingId: string): Promise<boolean> {
    const now = new Date();
    const row = await this.prisma.entitlement.findFirst({
      where: {
        listingId,
        type: EntitlementType.FEATURED_LISTING,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    return row !== null;
  }

  /** Returns all active entitlements for a user (for the /my-entitlements endpoint). */
  async findActiveForUser(userId: string) {
    const now = new Date();
    return this.prisma.entitlement.findMany({
      where: {
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
