import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BaseBlockDto } from './base-block.dto';

export class QuoteBlockDto extends BaseBlockDto {
  @IsIn(['quote'])
  type!: 'quote';

  @IsString()
  @MaxLength(1000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  author?: string;
}
