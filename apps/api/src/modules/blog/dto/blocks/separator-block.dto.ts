import { IsIn } from 'class-validator';
import { BaseBlockDto } from './base-block.dto';

// Sin datos propios — el separador es puramente visual.
export class SeparatorBlockDto extends BaseBlockDto {
  @IsIn(['separator'])
  type!: 'separator';
}
