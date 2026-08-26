import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
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
}
