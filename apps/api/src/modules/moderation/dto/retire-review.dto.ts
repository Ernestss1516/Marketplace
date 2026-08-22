import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * 7b — RETIRAR una valoración.
 *
 * El motivo es OBLIGATORIO, molde del `reason` de P3a: sin él una retirada sería
 * indistinguible de otra y no habría cómo revisarla. Va al `AuditLog` **y** a la propia
 * fila (`retiredReason`), para que la decisión sea auditable en el registro mismo y no
 * sólo en una tabla aparte.
 */
export class RetireReviewDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

/**
 * 7b — EDITAR el texto o las estrellas de una valoración ajena.
 *
 * Rangos idénticos a los del DTO del autor: el staff edita la misma valoración con las
 * mismas reglas — el criterio de P3a («valida igual que el dueño»).
 */
export class ModerateReviewDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
