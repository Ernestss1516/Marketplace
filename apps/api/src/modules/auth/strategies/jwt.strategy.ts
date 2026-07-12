import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { JwtPayload, JwtUser } from '../auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.secret'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtUser> {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true, role: true, emailVerified: true, tokenVersion: true },
    });

    if (!dbUser) throw new UnauthorizedException('User not found');

    // Un resetPassword/changePassword/setPassword incrementa tokenVersion —
    // cualquier token firmado antes de eso queda inválido al instante, sin
    // esperar a su expiración natural (RÁFAGA 3).
    if (dbUser.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Session invalidated');
    }

    if (dbUser.status === UserStatus.SUSPENDED)
      throw new ForbiddenException('Tu cuenta está suspendida. Contacta con soporte si crees que es un error.');
    if (dbUser.status === UserStatus.BANNED)
      throw new ForbiddenException('Tu cuenta ha sido inhabilitada permanentemente.');

    return {
      userId: payload.sub,
      email: payload.email,
      // role/emailVerified se leen frescos de la BD (ya se consulta por status
      // y tokenVersion arriba, coste cero) — no del payload firmado. Cierra la
      // deuda de "rol stale hasta 7 días": un cambio de rol tiene efecto en la
      // siguiente request, no en el siguiente login (RÁFAGA 3).
      role: dbUser.role,
      emailVerified: dbUser.emailVerified,
    };
  }
}
