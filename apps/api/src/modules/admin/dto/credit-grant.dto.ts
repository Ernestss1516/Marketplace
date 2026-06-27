import { IsInt, IsNotEmpty, IsString, MaxLength, Min, Max, MinLength } from 'class-validator';

export class CreditGrantDto {
  @IsInt()
  @Min(1)
  @Max(10000)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
