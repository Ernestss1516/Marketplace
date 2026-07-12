import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BaseBlockDto } from './base-block.dto';
import { IsOwnStorageUrl } from '../../../../common/validators/safe-url';

export class ProfileImageDto {
  @IsOwnStorageUrl()
  url!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  alt!: string;
}

export class ProfileAttributeDto {
  @IsString()
  @MaxLength(100)
  label!: string;

  @IsString()
  @MaxLength(300)
  value!: string;
}

export class ProfileBlockDto extends BaseBlockDto {
  @IsIn(['profile'])
  type!: 'profile';

  @IsOptional()
  @ValidateNested()
  @Type(() => ProfileImageDto)
  image?: ProfileImageDto;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  // Mismo molde de array repetible que faq/hub/steps — reutiliza SubItemList
  // en el editor.
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProfileAttributeDto)
  attributes!: ProfileAttributeDto[];
}
