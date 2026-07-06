import {
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** `type` no es editable: cambiar de type sería, en la práctica, otra campaña. */
export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  /** Shape validado en CampaignsService.validateParams según el `type` (inmutable) existente. */
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}
