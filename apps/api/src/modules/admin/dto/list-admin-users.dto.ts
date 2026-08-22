import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { Role, UserStatus } from '@prisma/client';

/**
 * ÚLTIMA IP (5b) — LOS ÓRDENES DE LA LISTA DE USUARIOS.
 *
 * Esta lista **no tenía eje de orden ninguno**: `listUsers` llevaba
 * `orderBy: { createdAt: 'desc' }` clavado. El marco de F2 (un mapa de órdenes + un
 * `order` en el DTO + la traducción a la URL) se **TRAE** aquí; no se extiende, porque el
 * de F2 es de `Listing` y no vale para `User`.
 */
export type AdminUsersOrder = 'last-login-desc' | 'last-login-asc' | 'recent' | 'oldest';

export class ListAdminUsersDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  q?: string;

  /**
   * ÚLTIMA IP (5b) — el filtro por la IP del ÚLTIMO INICIO DE SESIÓN.
   *
   * Es la IP **del usuario**, la que 5a captura en el login, y su finalidad es
   * antifraude: cazar multicuenta y evasión de baneo. **No tiene nada que ver con
   * `AuditLog.ip`**, que es la del staff y que 5a sacó de esta respuesta. Ver
   * `docs/diseno-ultima-ip.md` §3 y §6.
   *
   * Coincidencia EXACTA y no `contains`: una IP es un identificador, no un texto que se
   * busque por partes. Un `contains` sobre «10.0.0.1» traería también «110.0.0.10», que
   * en una investigación es exactamente el error que no se puede permitir.
   */
  @IsOptional()
  @IsString()
  ip?: string;

  /**
   * A1 — «su última conexión fue desde una IP marcada».
   *
   * Distinto de `ip`, que pregunta por UNA concreta: esto pregunta por la lista entera, que
   * es la forma de revisar de golpe a todo el que entró desde algún sitio vigilado.
   *
   * DERIVADO —`lastLoginIp IN (lista)`— y no contra ninguna tabla espejo: quitar una IP de
   * la lista deja de traer a su gente **al instante**, en todo el histórico. Es la propiedad
   * que hace que una lista de vigilancia se pueda rectificar.
   */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === 'true' || value === true))
  @IsBoolean()
  ipFlagged?: boolean;

  @IsOptional()
  @IsIn(['last-login-desc', 'last-login-asc', 'recent', 'oldest'])
  order?: AdminUsersOrder;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  perPage?: number = 24;
}
