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
      select: { status: true },
    });

    if (!dbUser) throw new UnauthorizedException('User not found');

    if (dbUser.status === UserStatus.SUSPENDED)
      throw new ForbiddenException('Tu cuenta está suspendida. Contacta con soporte si crees que es un error.');
    if (dbUser.status === UserStatus.BANNED)
      throw new ForbiddenException('Tu cuenta ha sido inhabilitada permanentemente.');

    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      emailVerified: payload.emailVerified,
    };
  }
}
