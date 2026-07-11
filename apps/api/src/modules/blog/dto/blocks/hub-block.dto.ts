import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BaseBlockDto } from './base-block.dto';
import { IsSafeContentUrl } from '../../../../common/validators/safe-url';

export class HubLinkDto {
  @IsString()
  @MaxLength(150)
  label!: string;

  // Ruta relativa ("/anuncio/...") o URL absoluta http/https — nunca
  // javascript:/data:. Ver common/validators/safe-url.ts.
  @IsSafeContentUrl()
  href!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

export class HubBlockDto extends BaseBlockDto {
  @IsIn(['hub'])
  type!: 'hub';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => HubLinkDto)
  links!: HubLinkDto[];
}
