import { IsISO8601, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * FICHA DE USUARIO — U2: conceder Pro a mano, sin que el usuario pague.
 *
 * `expiresAt` OBLIGATORIO, y no es una limitación técnica: el modelo admite
 * `expiresAt: null` (Pro perpetuo) y precisamente por eso el endpoint no lo
 * ofrece. Un producto de pago regalado sin fecha es una fuga que nadie vuelve a
 * mirar; si hace falta más tiempo, se concede otra vez. Ver
 * docs/diseno-ficha-usuario.md §2.1 y §7 (D-4).
 *
 * `reason` obligatorio con el mismo rango que `CreditGrantDto` — es la misma
 * clase de acción (regalar algo que vale dinero) y se sigue su molde en vez de
 * inventar otro. Va al `AuditLog`, no al entitlement: el «por qué» es historia de
 * una decisión, no un atributo del derecho concedido.
 */
export class GrantProDto {
  @IsISO8601()
  expiresAt!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
