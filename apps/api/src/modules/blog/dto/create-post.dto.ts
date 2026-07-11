import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
} from 'class-validator';
import { PostType } from '@prisma/client';
import { BlockDto, ValidBlocksArray } from './blocks/block.dto';

export class CreatePostDto {
  // Omitido para crear un POST (blog) normal — el service usa PostType.POST por
  // defecto. Solo /admin/paginas envía PAGE explícitamente. Ausente de
  // UpdatePostDto a propósito: el tipo es inmutable tras crear.
  @IsOptional()
  @IsEnum(PostType)
  type?: PostType;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase letters, numbers and hyphens only',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  excerpt?: string;

  // Array ordenado (el orden ES la posición en el array, no un campo `order`
  // — no son filas separadas como FooterItem). Omitido → [] en el servicio.
  // Validación profunda por tipo vía discriminador (ver ValidBlocksArray).
  @IsOptional()
  @ValidBlocksArray()
  blocks?: BlockDto[];

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  coverUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  metaTitle?: string;

  @IsOptional()
  @IsString()
  metaDescription?: string;
}
