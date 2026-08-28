import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * NOTIFICACIONES N2 — EL MOTIVO DE UN BANEO.
 *
 * ── POR QUÉ ES UN DTO NUEVO Y NO UN CAMPO MÁS ───────────────────────────────
 *
 * Porque `banUser` **no recibía cuerpo ninguno**: la firma era
 * `banUser(id, actorId, ip)` y el endpoint no declaraba `@Body()`. No había dónde
 * escribir un motivo, que es lo que la auditoría dejó anotado (§A3.3): no era un
 * defecto de presentación, faltaba la entrada entera.
 *
 * ── EL BANEO ES DONDE MÁS FALTA HACE EL MOTIVO ──────────────────────────────
 *
 * Un `BANNED` **no puede entrar**: el gate de `account-access.ts` lo rechaza en las
 * tres puertas. No hay campana que pueda abrir, así que lo único que le llega es
 * el correo y el mensaje que ve al intentar entrar — y hasta N2 los dos decían
 * «tu cuenta ha sido inhabilitada permanentemente» y nada más. Una sanción
 * permanente sin una palabra de por qué.
 *
 * ── CUERPO OPCIONAL, COMO EL DE SUSPENDER ───────────────────────────────────
 *
 * Molde `ChangeListingStatusDto.reason`, replicado sin variantes: opcional, con
 * degradación limpia cuando falta. Además mantiene la ráfaga ADITIVA — el endpoint
 * no llevaba cuerpo, así que exigirlo rompería a todo el que ya banea.
 */
export class BanUserDto {
  /** El motivo VISIBLE: se le muestra al usuario en su correo y al intentar entrar. */
  @ApiPropertyOptional({
    description:
      'Motivo VISIBLE para el usuario. En un baneo es el único contexto que va a recibir: ' +
      'no puede entrar a leer su campana.',
    minLength: 5,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason?: string;

  /** La nota INTERNA: `AuditLog` y nada más. El usuario NO la ve. */
  @ApiPropertyOptional({
    description:
      'Nota INTERNA para el staff. Va al registro de auditoría y NUNCA se le muestra al ' +
      'usuario, ni en la notificación ni en el correo.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNote?: string;
}
