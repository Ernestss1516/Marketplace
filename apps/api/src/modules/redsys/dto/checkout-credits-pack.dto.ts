import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CheckoutCreditsPackDto {
  @ApiProperty({ description: 'ID of the CreditPack to purchase' })
  @IsString()
  @IsNotEmpty()
  packId!: string;
}
