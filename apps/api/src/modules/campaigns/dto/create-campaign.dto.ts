import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CampaignType } from '@prisma/client';
import { CampaignParamsDto } from './campaign-params.dto';

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsEnum(CampaignType)
  type!: CampaignType;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;

  @ValidateNested()
  @Type(() => CampaignParamsDto)
  params!: CampaignParamsDto;
}
