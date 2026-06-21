import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_NOTIFICATIONS } from '../../infra/queue/queue.constants';
import {
  NOTIFICATION_JOB,
  SendResetEmailData,
  SendVerificationEmailData,
} from '../../infra/queue/notification.types';
import { JwtPayload } from './auth.types';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

const BCRYPT_ROUNDS = 12;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly notificationQueue: Queue,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const slug = await this.generateUniqueSlug(dto.name);

    const user = await this.prisma.user.create({
      data: { name: dto.name, email: dto.email, passwordHash, slug },
      select: { id: true, name: true, email: true, slug: true, emailVerified: true },
    });

    const token = await this.createVerificationToken(user.id);
    await this.notificationQueue.add(NOTIFICATION_JOB.SEND_VERIFICATION_EMAIL, {
      userId: user.id,
      email: user.email,
      name: user.name,
      token,
    } satisfies SendVerificationEmailData);

    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        name: true,
        email: true,
        slug: true,
        role: true,
        emailVerified: true,
        passwordHash: true,
      },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials');

    const accessToken = this.signToken(user);
    return {
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, slug: user.slug, role: user.role, emailVerified: user.emailVerified },
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const record = await this.prisma.verificationToken.findUnique({
      where: { token: dto.token },
      include: { user: { select: { id: true, email: true, role: true, emailVerified: true } } },
    });

    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired token');
    }

    const user = await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: true },
      select: { id: true, email: true, role: true, emailVerified: true },
    });

    await this.prisma.verificationToken.delete({ where: { id: record.id } });

    const accessToken = this.signToken(user);
    return { verified: true, accessToken };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, name: true },
    });

    // Always return ok — never reveal if the email exists
    if (user) {
      const token = await this.createResetToken(user.id);
      await this.notificationQueue.add(NOTIFICATION_JOB.SEND_RESET_EMAIL, {
        email: user.email,
        name: user.name,
        token,
      } satisfies SendResetEmailData);
    }

    return { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token: dto.token },
    });

    if (!record || record.expiresAt < new Date() || record.usedAt) {
      throw new BadRequestException('Invalid or expired token');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { ok: true };
  }

  signToken(user: { id: string; email: string; role: string; emailVerified: boolean }): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as JwtPayload['role'],
      emailVerified: user.emailVerified,
    };
    return this.jwt.sign(payload);
  }

  async createVerificationToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
    await this.prisma.verificationToken.deleteMany({ where: { userId } });
    await this.prisma.verificationToken.create({ data: { userId, token, expiresAt } });
    return token;
  }

  private async createResetToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);
    await this.prisma.passwordResetToken.create({ data: { userId, token, expiresAt } });
    return token;
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);

    const existing = await this.prisma.user.findMany({
      where: { slug: { startsWith: base } },
      select: { slug: true },
    });

    if (!existing.length) return base;

    const slugs = new Set(existing.map((u) => u.slug));
    if (!slugs.has(base)) return base;

    let i = 1;
    while (slugs.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }
}
