import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ListingStatus } from '@prisma/client';

export class ChangeListingStatusDto {
  @IsEnum(ListingStatus)
  status!: ListingStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}
