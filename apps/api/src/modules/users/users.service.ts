import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
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
  role: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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

  async findBySlug(slug: string) {
    const user = await this.prisma.user.findUnique({
      where: { slug },
      select: {
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
    const { createdAt, ...rest } = user;
    return { ...rest, memberSince: createdAt };
  }
}
