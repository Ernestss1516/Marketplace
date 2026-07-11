import { IsIn, IsString, MaxLength } from 'class-validator';
import { BaseBlockDto } from './base-block.dto';

// Markdown, no rich text — reutiliza tal cual la tubería ya auditada
// (react-markdown + remark-gfm + rehype-sanitize, SIN rehype-raw) tanto para
// escribir (MarkdownEditor) como para pintar (MarkdownBody). Ver el diseño
// aprobado: cero superficie de seguridad nueva, cero dependencia nueva.
export class TextBlockDto extends BaseBlockDto {
  @IsIn(['text'])
  type!: 'text';

  @IsString()
  @MaxLength(20000)
  markdown!: string;
}
