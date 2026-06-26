import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CheckoutFeaturedPayDto {
  @ApiProperty({ description: 'ID of the Price (featured listing variant: 7d / 14d / 30d)' })
  @IsString()
  @IsNotEmpty()
  priceId!: string;

  @ApiProperty({ description: 'ID of the Listing to feature' })
  @IsString()
  @IsNotEmpty()
  listingId!: string;
}
