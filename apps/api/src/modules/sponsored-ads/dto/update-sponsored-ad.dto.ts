import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

/** Todo editable, igual que Banner — un patrocinado no se distribuye fuera de la app. */
export class UpdateSponsoredAdDto {
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  description?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  targetUrl?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  categoryId?: string;

  @IsOptional()
  @IsInt()
  order?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** null limpia la fecha (patrocinado sin ventana de inicio/fin). */
  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;

  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;
}
