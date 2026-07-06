import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PostType } from '@prisma/client';

// Trim + blank→undefined es higiene de datos, no una regla de negocio — vive en
// el DTO. La regla "solo aplica a PAGE" sí depende del type resuelto, por eso
// vive en el servicio (assertFooterFieldsAllowed), igual que showInFooter/footerOrder.
const trimToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

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

  @IsOptional()
  @IsString()
  body?: string;

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

  // Solo aplican a type=PAGE — el servicio rechaza (400) si se envían junto a un
  // POST (el DTO no puede validar esto por sí solo: valida antes de resolver el
  // default type ?? POST). Ver BlogService.assertFooterFieldsAllowed().
  @IsOptional()
  @IsBoolean()
  showInFooter?: boolean;

  @IsOptional()
  @IsInt()
  footerOrder?: number;

  // Nombre de columna en el footer agrupado — texto libre, NO enum. Trim
  // aplicado aquí (higiene); blank pasa a undefined. Sin normalización de
  // mayúsculas: el admin controla el casing visible del encabezado.
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(50)
  footerGroup?: string;
}
