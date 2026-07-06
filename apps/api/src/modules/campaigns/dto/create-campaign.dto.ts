import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CampaignType } from '@prisma/client';

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

  /**
   * Shape validado en CampaignsService.validateParams según `type` (switch),
   * no aquí — class-validator no soporta bien "elige la clase anidada según
   * un campo hermano" sin decoradores ad-hoc. Ver CampaignParamsDto
   * (CREDIT_BONUS) y ActionDiscountParamsDto (ACTION_DISCOUNT).
   */
  @IsObject()
  params!: Record<string, unknown>;
}
