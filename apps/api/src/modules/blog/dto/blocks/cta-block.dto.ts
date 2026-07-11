import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BaseBlockDto } from './base-block.dto';
import { IsSafeContentUrl } from '../../../../common/validators/safe-url';

const STYLES = ['primary', 'secondary', 'outline'] as const;
export type CtaStyle = (typeof STYLES)[number];

export class CtaBlockDto extends BaseBlockDto {
  @IsIn(['cta'])
  type!: 'cta';

  @IsString()
  @MaxLength(100)
  label!: string;

  @IsSafeContentUrl()
  href!: string;

  @IsOptional()
  @IsIn(STYLES)
  style?: CtaStyle;
}
