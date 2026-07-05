import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Igual que JwtAuthGuard pero nunca rechaza la petición: si no hay token, o es
 * inválido/expirado, req.user queda null en vez de lanzar 401. Para endpoints
 * públicos que necesitan saber "quién mira" solo cuando hay sesión (p. ej.
 * tracking de vistas — excluir al dueño, contar anónimos igualmente).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(_err: unknown, user: TUser | false): TUser | null {
    return user ? user : null;
  }
}
