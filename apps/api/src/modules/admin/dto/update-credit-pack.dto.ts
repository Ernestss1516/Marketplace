import { IsBoolean, IsInt, IsOptional, IsPositive, Max } from 'class-validator';

export class UpdateCreditPackDto {
  @IsInt()
  @IsPositive()
  @Max(1000000)
  creditAmount!: number;

  /**
   * Monetización ráfaga 2 — cuando true, el catálogo público añade el campo
   * derivado bumpEquivalent (créditos del pack ÷ bumpCreditCost vigente,
   * calculado en vivo). Omitido = sin cambios.
   */
  @IsOptional()
  @IsBoolean()
  highlightBumps?: boolean;
}
