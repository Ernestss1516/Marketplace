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
import { IsOwnStorageUrl } from '../../../../common/validators/safe-url';

// Mismo molde de array repetible que FaqItemDto/HubLinkDto (faq-block.dto.ts,
// hub-block.dto.ts) — reutiliza SubItemList en el editor tal cual, sin
// generalizar nada nuevo.
export class StepItemDto {
  @IsString()
  @MaxLength(150)
  title!: string;

  @IsString()
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @IsOwnStorageUrl()
  image?: string;
}

export class StepsBlockDto extends BaseBlockDto {
  @IsIn(['steps'])
  type!: 'steps';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => StepItemDto)
  items!: StepItemDto[];
}
