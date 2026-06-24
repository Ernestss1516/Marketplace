import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportReason } from '@prisma/client';

export class CreateReportDto {
  @ApiProperty({ enum: ReportReason })
  @IsEnum(ReportReason)
  reason!: ReportReason;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'ID del anuncio reportado' })
  @IsString()
  @IsOptional()
  listingId?: string;

  @ApiPropertyOptional({ description: 'ID del usuario reportado' })
  @IsString()
  @IsOptional()
  reportedUserId?: string;
  // Service validates that at least one of listingId or reportedUserId is present.
}
