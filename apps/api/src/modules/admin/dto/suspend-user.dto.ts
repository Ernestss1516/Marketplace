import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * BORRADO DE CUENTAS C4 — CUÁNTO DURA UNA SUSPENSIÓN.
 *
 * ── DÍAS Y NO UNA FECHA, y no es indiferente ────────────────────────────────
 *
 * Una fecha viajando por JSON arrastra zona horaria: el moderador escribe «hasta
 * el 3», el servidor la interpreta en UTC y la sanción termina unas horas antes o
 * después de lo que esa persona creía. «Siete días» no tiene ese problema — se
 * cuenta desde ahora, en el servidor, y significa lo mismo en cualquier huso.
 *
 * ── OMITIRLO NO SIGNIFICA «PARA SIEMPRE» POR CAPRICHO ───────────────────────
 *
 * Si no viene, la duración sale del `Setting` `defaultSuspensionDays`, y ese
 * ajuste **nace sin valor**: sin configurarlo, una suspensión sin días es
 * INDEFINIDA, que es exactamente lo que era antes de C4. Es lo que hace que esta
 * ráfaga no cambie ni una conducta observable el día que se despliega — quien
 * quiera que el botón «Suspender» pase a significar siete días, lo configura.
 */
export class SuspendUserDto {
  @ApiPropertyOptional({
    description:
      'Días que dura la suspensión, contados desde ahora. Si se omite, se usa el ajuste ' +
      '`defaultSuspensionDays`; si tampoco está configurado, la suspensión es indefinida.',
    minimum: 1,
    maximum: 365,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  // Mínimo 1: una suspensión de cero días no es una sanción, es un no-op con
  // registro de auditoría. Máximo 365: por encima de un año, lo que se quiere
  // decir es «permanente», y para eso está el ban — que además es de ADMIN, que
  // es justo la puerta que una suspensión de diez años estaría esquivando.
  @Min(1)
  @Max(365)
  days?: number;

  /**
   * NOTIFICACIONES N2 — EL MOTIVO VISIBLE. Se le MUESTRA al usuario.
   *
   * OPCIONAL, replicando `ChangeListingStatusDto.reason` sin variantes: es el
   * motivo que ya funciona y ya se degrada limpiamente cuando falta. Hacerlo
   * obligatorio cambiaría en silencio lo que hace un botón que los moderadores ya
   * usan —y rompería a todo el que suspende sin cuerpo—, que es justo lo que C4
   * se cuidó de no hacer con `days`.
   */
  @ApiPropertyOptional({
    description:
      'Motivo VISIBLE para el usuario: viaja a su notificación, a su correo y al mensaje ' +
      'que ve al intentar entrar. Se escribe sabiendo que lo lee la persona sancionada.',
    minLength: 5,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason?: string;

  /**
   * LA NOTA INTERNA — el usuario NO la ve. Va al `AuditLog` y a nada más.
   *
   * Existe para que el motivo visible no tenga que cargar con el contexto del
   * equipo: la sospecha que no se afirma, el hilo que lo destapó, el aviso al
   * siguiente moderador. Sin este campo, ese contexto acabaría metido en `reason`
   * — y `reason` se le enseña al sancionado.
   */
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
