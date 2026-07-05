import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class FeaturedByCreditsDto {
  @ApiProperty({ description: 'ID of the Listing to feature' })
  @IsString()
  @IsNotEmpty()
  listingId!: string;

  @ApiPropertyOptional({
    description:
      'H8.5a — user-chosen path: true = free grant from the Pro monthly quota (fixed ' +
      "duration, does not require priceId); false/omitted = pay with credits (user's " +
      'chosen duration via priceId). The backend never picks quota automatically.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  useQuota?: boolean;

  @ApiPropertyOptional({
    description:
      'ID of the Price for the featured listing variant (7d / 14d / 30d). Required when ' +
      'useQuota is false; ignored when useQuota is true (the quota uses a fixed duration ' +
      "set by the proQuotaFeaturedDurationDays admin setting).",
  })
  @ValidateIf((dto: FeaturedByCreditsDto) => !dto.useQuota)
  @IsString()
  @IsNotEmpty()
  priceId?: string;
}
