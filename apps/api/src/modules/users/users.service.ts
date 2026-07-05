import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EntitlementService } from '../billing/entitlement.service';
import { UpdateMeDto } from './dto/update-me.dto';

const PRIVATE_PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  slug: true,
  phone: true,
  avatarUrl: true,
  bio: true,
  city: true,
  province: true,
  postalCode: true,
  emailVerified: true,
  role: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
  ) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: PRIVATE_PROFILE_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  updateMe(id: string, dto: UpdateMeDto) {
    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: PRIVATE_PROFILE_SELECT,
    });
  }

  /** H8.4 — perfil público del vendedor. isPro se calcula una sola vez (no hay N+1: un vendedor, no un listado). */
  async findBySlug(slug: string) {
    const user = await this.prisma.user.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        avatarUrl: true,
        bio: true,
        city: true,
        province: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const { id, createdAt, ...rest } = user;
    const isPro = await this.entitlements.isProActive(id);
    return { ...rest, memberSince: createdAt, isPro };
  }
}
