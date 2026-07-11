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

export class FaqItemDto {
  @IsString()
  @MaxLength(300)
  question!: string;

  // Markdown corto — misma tubería MarkdownBody que text.markdown al pintar
  // (rehype-sanitize sin rehype-raw), así que no hace falta un límite tan
  // generoso como el bloque de texto completo.
  @IsString()
  @MaxLength(2000)
  answer!: string;
}

export class FaqBlockDto extends BaseBlockDto {
  @IsIn(['faq'])
  type!: 'faq';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => FaqItemDto)
  items!: FaqItemDto[];
}
