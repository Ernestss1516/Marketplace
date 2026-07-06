import { IsBoolean, IsISO8601, IsInt, IsOptional, Min } from 'class-validator';

/**
 * `code` y `rewardType` NO son editables: cambiarlos sería, en la práctica, otro
 * cupón (código ya distribuido / recompensa distinta). Solo se puede ajustar el
 * VALOR de la recompensa del type ya fijado (creditAmount o featuredDurationDays,
 * según cuál aplique — CouponsService lo comprueba contra el rewardType existente).
 */
export class UpdateCouponDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  /** Omitido = sin cambios; null = quitar el límite (ilimitado). */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number | null;

  /** Solo válido si el cupón es rewardType=CREDITS. */
  @IsOptional()
  @IsInt()
  @Min(1)
  creditAmount?: number;

  /** Solo válido si el cupón es rewardType=FEATURED. */
  @IsOptional()
  @IsInt()
  @Min(1)
  featuredDurationDays?: number;
}
