import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CheckoutBumpPackDto {
  @ApiProperty({ description: 'ID of the BumpPack to purchase' })
  @IsString()
  @IsNotEmpty()
  packId!: string;
}
