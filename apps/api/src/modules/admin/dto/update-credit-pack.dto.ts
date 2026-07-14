import { IsInt, IsPositive, Max } from 'class-validator';

export class UpdateCreditPackDto {
  @IsInt()
  @IsPositive()
  @Max(1000000)
  creditAmount!: number;
}
