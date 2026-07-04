import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { Role, UserStatus } from '@prisma/client';
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
import { SocialLoginDto } from './dto/social-login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

const SOCIAL_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  slug: true,
  role: true,
  status: true,
  emailVerified: true,
} as const;

type SocialUser = {
  id: string;
  name: string;
  email: string;
  slug: string;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
};

const BCRYPT_ROUNDS = 12;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
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
        status: true,
        emailVerified: true,
        passwordHash: true,
      },
    });

    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials');

    if (user.status === UserStatus.SUSPENDED)
      throw new ForbiddenException('Tu cuenta está suspendida. Contacta con soporte si crees que es un error.');
    if (user.status === UserStatus.BANNED)
      throw new ForbiddenException('Tu cuenta ha sido inhabilitada permanentemente.');

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
      select: { id: true, email: true, name: true, passwordHash: true },
    });

    // Always return ok — never reveal if the email exists or is a Google-only account
    if (user && user.passwordHash) {
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

  async loginWithGoogle(dto: SocialLoginDto) {
    let payload: { sub?: string; email?: string; email_verified?: boolean; name?: string; picture?: string } | undefined;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: dto.idToken,
        audience: this.config.getOrThrow<string>('google.clientId'),
      });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google token');
    }

    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('Invalid Google token');
    }

    const user = await this.linkOrCreateSocialUser({
      provider: 'google',
      providerAccountId: payload.sub,
      email: payload.email,
      emailVerifiedByProvider: payload.email_verified === true,
      name: payload.name ?? '',
      avatarUrl: payload.picture,
    });

    if (user.status === UserStatus.SUSPENDED)
      throw new ForbiddenException('Tu cuenta está suspendida. Contacta con soporte si crees que es un error.');
    if (user.status === UserStatus.BANNED)
      throw new ForbiddenException('Tu cuenta ha sido inhabilitada permanentemente.');

    const accessToken = this.signToken(user);
    return {
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, slug: user.slug, role: user.role, emailVerified: user.emailVerified },
    };
  }

  /**
   * Vincula (por email verificado por el proveedor) o crea el User correspondiente a una
   * identidad social. Nunca confía en un booleano recibido tal cual: el llamante debe haber
   * verificado emailVerifiedByProvider criptográficamente contra el proveedor.
   */
  private async linkOrCreateSocialUser(params: {
    provider: string;
    providerAccountId: string;
    email: string;
    emailVerifiedByProvider: boolean;
    name: string;
    avatarUrl?: string;
  }): Promise<SocialUser> {
    const existingAccount = await this.prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: params.provider,
          providerAccountId: params.providerAccountId,
        },
      },
      select: { user: { select: SOCIAL_USER_SELECT } },
    });
    if (existingAccount) return existingAccount.user;

    const existingUser = await this.prisma.user.findUnique({
      where: { email: params.email },
      select: SOCIAL_USER_SELECT,
    });

    if (existingUser) {
      if (!params.emailVerifiedByProvider) {
        throw new ForbiddenException(
          'No se pudo verificar la propiedad de este email con Google. Inicia sesión con tu contraseña.',
        );
      }

      return this.prisma.$transaction(async (tx) => {
        await tx.account.create({
          data: {
            userId: existingUser.id,
            provider: params.provider,
            providerAccountId: params.providerAccountId,
          },
        });
        if (existingUser.emailVerified) return existingUser;
        return tx.user.update({
          where: { id: existingUser.id },
          data: { emailVerified: true },
          select: SOCIAL_USER_SELECT,
        });
      });
    }

    if (!params.emailVerifiedByProvider) {
      throw new ForbiddenException('No se pudo verificar la propiedad de este email con Google.');
    }

    const slug = await this.generateUniqueSlug(params.name, params.email);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: params.email,
          name: params.name || params.email.split('@')[0],
          slug,
          passwordHash: null,
          emailVerified: true,
          avatarUrl: params.avatarUrl,
        },
        select: SOCIAL_USER_SELECT,
      });
      await tx.account.create({
        data: {
          userId: created.id,
          provider: params.provider,
          providerAccountId: params.providerAccountId,
        },
      });
      return created;
    });
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

  private async generateUniqueSlug(name: string, fallbackSeed?: string): Promise<string> {
    const slugify = (value: string) =>
      value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);

    // name from OAuth profiles can be empty, emoji-only, or entirely non-latin — none of
    // that survives slugify(). Fall back to the email local-part, then a generic slug.
    let base = slugify(name);
    if (!base && fallbackSeed) base = slugify(fallbackSeed.split('@')[0]);
    if (!base) base = 'usuario';

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
