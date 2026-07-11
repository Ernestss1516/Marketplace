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

export class CreateSponsoredAdDto {
  /** URL devuelta por POST /admin/sponsored-ads/upload-image. */
  @IsUrl({ require_tld: false, require_protocol: true })
  imageUrl!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  /** Enlace EXTERNO al que navega el click — nunca una ruta interna del marketplace. */
  @IsUrl({ require_tld: false, require_protocol: true })
  targetUrl!: string;

  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsOptional()
  @IsInt()
  order?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;
}
