import { IsNumber, IsPositive, Max } from 'class-validator';

export class UpdatePriceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(9999.99)
  amount!: number;
}
