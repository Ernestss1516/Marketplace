import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { FooterItemType } from '@prisma/client';

// El DTO solo valida la FORMA de cada campo por separado. La coherencia
// cruzada del destino discriminado por `type` (PAGE → pageId obligatorio +
// url null; INTERNAL → url obligatorio empezando por "/" + pageId null;
// EXTERNAL → url obligatorio como URL absoluta + pageId null) vive en
// FooterService.assertItemDestination — EN EL SERVICIO, no aquí, mismo
// estilo que Post.assertFooterFieldsAllowed. No es un CHECK de schema
// tampoco: Prisma no valida esta coherencia por sí solo.
//
// INTERNAL: `url` es una ruta libre — NO existe un registro de rutas reales
// en el proyecto (confirmado al observar el sistema de rutas del frontend),
// así que una ruta inexistente se acepta y solo se descubre en runtime como
// 404. Aceptado conscientemente: un registro de rutas está fuera de alcance
// de este mini-hito.
export class CreateFooterItemDto {
  @IsString()
  columnId!: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsEnum(FooterItemType)
  type!: FooterItemType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  pageId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  url?: string;
}
