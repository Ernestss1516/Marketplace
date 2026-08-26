import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * BORRADO DE CUENTAS C2 — el porqué NARRATIVO de un archivado.
 *
 * Opcional en las dos entradas, y por motivos distintos: al usuario no se le
 * exige explicar por qué se va (sería una barrera a un derecho), y al staff se le
 * ofrece pero no se le obliga — a diferencia de `Review.retiredReason`, que sí es
 * obligatorio porque una retirada sin motivo es indistinguible de otra.
 *
 * La CATEGORÍA (`SELF_REQUEST` / `STAFF_ACTION`) no viaja en el DTO: la fija el
 * endpoint por el que se entra, para que nadie pueda archivar a otro diciendo que
 * lo pidió él.
 */
export class ArchiveAccountDto {
  @ApiPropertyOptional({ description: 'Motivo, en texto libre. Opcional.', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
