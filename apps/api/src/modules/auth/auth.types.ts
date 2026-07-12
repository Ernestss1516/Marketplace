import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  /// Comparado contra User.tokenVersion en cada request (JwtStrategy); un
  /// resetPassword/changePassword/setPassword lo incrementa e invalida así
  /// todos los tokens emitidos antes (RÁFAGA 3).
  tokenVersion: number;
}

export interface JwtUser {
  userId: string;
  email: string;
  role: Role;
  emailVerified: boolean;
}
