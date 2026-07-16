import { IsInt, IsPositive, Max } from 'class-validator';

export class UpdateBumpPackDto {
  @IsInt()
  @IsPositive()
  @Max(1000000)
  bumpAmount!: number;
}
