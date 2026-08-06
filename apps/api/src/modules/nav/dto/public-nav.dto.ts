import { IsEnum } from 'class-validator';
import { NavPageType } from '@prisma/client';

/**
 * Query de GET /nav (público). `pageType` es OBLIGATORIO: el endpoint devuelve
 * el árbol ya podado para un tipo de página concreto, así que sin él la
 * pregunta no está completa (mismo criterio que ActiveBannersDto, que también
 * exige `placement`).
 *
 * @IsEnum rechaza cualquier valor fuera de NavPageType con un 400 antes de
 * llegar al servicio.
 */
export class PublicNavQueryDto {
  @IsEnum(NavPageType)
  pageType!: NavPageType;
}
