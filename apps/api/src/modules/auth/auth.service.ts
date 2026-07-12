import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
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
import { RateLimitService } from '../../infra/redis/rate-limit.service';
import { QUEUE_NOTIFICATIONS } from '../../infra/queue/queue.constants';
import {
  NOTIFICATION_JOB,
  SendResetEmailData,
  SendVerificationEmailData,
} from '../../infra/queue/notification.types';
import { JwtPayload } from './auth.types';
import {
  CHANGE_PASSWORD_RATE_LIMIT_PER_HOUR,
  CHANGE_PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
  FORGOT_PASSWORD_RATE_LIMIT_EMAIL_PER_HOUR,
  FORGOT_PASSWORD_RATE_LIMIT_IP_PER_HOUR,
  FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
  LOGIN_RATE_LIMIT_IP_PER_WINDOW,
  LOGIN_RATE_LIMIT_IP_WINDOW_SECONDS,
  LOCKOUT_THRESHOLD,
  REGISTER_RATE_LIMIT_IP_PER_HOUR,
  REGISTER_RATE_LIMIT_WINDOW_SECONDS,
  computeLockoutMinutes,
} from './auth.constants';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetPasswordDto } from './dto/set-password.dto';
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
  tokenVersion: true,
} as const;

type SocialUser = {
  id: string;
  name: string;
  email: string;
  slug: string;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  tokenVersion: number;
};

const BCRYPT_ROUNDS = 12;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

function tooManyRequests(retryAfter: number): never {
  throw new HttpException(
    { message: 'Demasiados intentos. Inténtalo más tarde.', retryAfter },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

@Injectable()
export class AuthService {
  private readonly googleClient = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly rateLimit: RateLimitService,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly notificationQueue: Queue,
  ) {}

  async register(dto: RegisterDto, ip: string) {
    const ipLimit = await this.rateLimit.checkAndIncrement(
      `auth:register:ip:${ip}`,
      REGISTER_RATE_LIMIT_IP_PER_HOUR,
      REGISTER_RATE_LIMIT_WINDOW_SECONDS,
    );
    if (ipLimit.limited) tooManyRequests(ipLimit.retryAfter);

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

  async login(dto: LoginDto, ip: string) {
    // Por IP y por email — el segundo protege una cuenta concreta aunque el
    // atacante rote de IP. Aplicado a la clave (email tal cual llega en el
    // body) exista o no la cuenta: nunca revela existencia por el propio 429.
    const ipLimit = await this.rateLimit.checkAndIncrement(
      `auth:login:ip:${ip}`,
      LOGIN_RATE_LIMIT_IP_PER_WINDOW,
      LOGIN_RATE_LIMIT_IP_WINDOW_SECONDS,
    );
    if (ipLimit.limited) tooManyRequests(ipLimit.retryAfter);

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
        failedLoginAttempts: true,
        lockedUntil: true,
        tokenVersion: true,
      },
    });

    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    // Cuenta bloqueada por intentos fallidos: mismo 401 genérico que cualquier
    // otro fallo, sin comprobar la contraseña — no revela que la cuenta existe
    // ni que está bloqueada (no-enumerable, igual que el resto de login()).
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      await this.registerFailedLogin(user.id, user.failedLoginAttempts);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === UserStatus.SUSPENDED)
      throw new ForbiddenException('Tu cuenta está suspendida. Contacta con soporte si crees que es un error.');
    if (user.status === UserStatus.BANNED)
      throw new ForbiddenException('Tu cuenta ha sido inhabilitada permanentemente.');

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    const accessToken = this.signToken(user);
    return {
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, slug: user.slug, role: user.role, emailVerified: user.emailVerified },
    };
  }

  /** Incrementa el contador de fallos y, a partir del umbral, bloquea la
   * cuenta con backoff exponencial (ver computeLockoutMinutes). */
  private async registerFailedLogin(userId: string, currentAttempts: number): Promise<void> {
    const attempts = currentAttempts + 1;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: attempts,
        ...(attempts >= LOCKOUT_THRESHOLD
          ? { lockedUntil: new Date(Date.now() + computeLockoutMinutes(attempts) * 60_000) }
          : {}),
      },
    });
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const record = await this.prisma.verificationToken.findUnique({
      where: { token: dto.token },
      include: {
        user: { select: { id: true, email: true, role: true, emailVerified: true, tokenVersion: true } },
      },
    });

    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired token');
    }

    const user = await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: true },
      select: { id: true, email: true, role: true, emailVerified: true, tokenVersion: true },
    });

    await this.prisma.verificationToken.delete({ where: { id: record.id } });

    const accessToken = this.signToken(user);
    return { verified: true, accessToken };
  }

  async forgotPassword(dto: ForgotPasswordDto, ip: string) {
    const ipLimit = await this.rateLimit.checkAndIncrement(
      `auth:forgot:ip:${ip}`,
      FORGOT_PASSWORD_RATE_LIMIT_IP_PER_HOUR,
      FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
    );
    if (ipLimit.limited) tooManyRequests(ipLimit.retryAfter);

    const emailLimit = await this.rateLimit.checkAndIncrement(
      `auth:forgot:email:${dto.email.toLowerCase()}`,
      FORGOT_PASSWORD_RATE_LIMIT_EMAIL_PER_HOUR,
      FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
    );
    if (emailLimit.limited) tooManyRequests(emailLimit.retryAfter);

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

    // tokenVersion incrementado atómicamente ({ increment: 1 }) → invalida al
    // instante TODOS los JWT emitidos antes de este reset (JwtStrategy los
    // compara contra el valor en BD en cada request). Decisión RÁFAGA 3.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
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

    // Decisión RÁFAGA 3: ADMIN solo entra con contraseña — la seguridad del
    // panel de admin no debe depender de la cuenta de Google del admin. El
    // Account (si existe) no se borra, solo deja de servir para autenticar.
    if (user.role === Role.ADMIN) {
      throw new ForbiddenException({
        message: 'Las cuentas de administración deben iniciar sesión con contraseña.',
        code: 'ADMIN_GOOGLE_LOGIN_BLOCKED',
      });
    }

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

  signToken(user: {
    id: string;
    email: string;
    role: string;
    emailVerified: boolean;
    tokenVersion: number;
  }): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as JwtPayload['role'],
      emailVerified: user.emailVerified,
      tokenVersion: user.tokenVersion,
    };
    return this.jwt.sign(payload);
  }

  /** Requiere la contraseña actual — para un usuario que ya tiene una. Incrementa
   * tokenVersion (cierra cualquier otra sesión) y devuelve un accessToken fresco
   * para que el propio llamante no se quede desconectado. */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ ok: true; accessToken: string }> {
    const limit = await this.rateLimit.checkAndIncrement(
      `auth:change-password:${userId}`,
      CHANGE_PASSWORD_RATE_LIMIT_PER_HOUR,
      CHANGE_PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
    );
    if (limit.limited) tooManyRequests(limit.retryAfter);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, role: true, emailVerified: true, passwordHash: true, tokenVersion: true },
    });

    if (!user.passwordHash) {
      throw new BadRequestException('Esta cuenta no tiene contraseña todavía — usa /auth/set-password.');
    }

    const passwordMatch = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!passwordMatch) throw new UnauthorizedException('Contraseña actual incorrecta.');

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
      select: { id: true, email: true, role: true, emailVerified: true, tokenVersion: true },
    });

    return { ok: true, accessToken: this.signToken(updated) };
  }

  /** Para un usuario solo-Google (passwordHash null): fija una contraseña por
   * primera vez, sin exigir una "actual" que no tiene. Cierra la deuda
   * "usuarios solo-Google no pueden fijar contraseña". Misma invalidación de
   * sesiones que changePassword — aunque no había contraseña que filtrar, el
   * usuario puede tener otras sesiones Google abiertas en otros dispositivos. */
  async setPassword(userId: string, dto: SetPasswordDto): Promise<{ ok: true; accessToken: string }> {
    const limit = await this.rateLimit.checkAndIncrement(
      `auth:change-password:${userId}`,
      CHANGE_PASSWORD_RATE_LIMIT_PER_HOUR,
      CHANGE_PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
    );
    if (limit.limited) tooManyRequests(limit.retryAfter);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });

    if (user.passwordHash) {
      throw new ConflictException('Esta cuenta ya tiene contraseña — usa /auth/change-password.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
      select: { id: true, email: true, role: true, emailVerified: true, tokenVersion: true },
    });

    return { ok: true, accessToken: this.signToken(updated) };
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
