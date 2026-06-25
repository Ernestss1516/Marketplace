import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckoutDto {
  @ApiProperty({ description: 'Our internal Price ID (cuid)' })
  @IsString()
  @MinLength(1)
  priceId!: string;

  @ApiPropertyOptional({ description: 'Required for ONE_TIME (destacado): the listing to feature' })
  @IsOptional()
  @IsString()
  listingId?: string;
}
