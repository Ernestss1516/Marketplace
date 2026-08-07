import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { BaseHomeBlockDto } from './base-home-block.dto';

export const LISTINGS_LIMITS = [4, 6, 8, 12] as const;
export type ListingsLimit = (typeof LISTINGS_LIMITS)[number];

/**
 * Bloque DINÁMICO: no guarda contenido, guarda una CONSULTA que se resuelve
 * contra SearchService en cada render.
 *
 * DIFERENCIA DE FONDO CON EL BLOQUE `listings` DEL BLOG: aquí `categorySlug` es
 * OPCIONAL (docs/diseno-portada.md §4.6). Ausente = los anuncios más recientes
 * de TODO el sitio, que es literalmente lo que la portada hacía escrito a mano.
 * El del blog lo exige porque dentro de un artículo "los recientes de todo el
 * sitio" no significa nada; en la portada es el caso principal.
 */
export class ListingsHomeBlockDto extends BaseHomeBlockDto {
  @IsIn(['listings'])
  type!: 'listings';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  /** Ausente = recientes de todo el sitio, sin filtrar por categoría. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  categorySlug?: string;

  @IsIn(LISTINGS_LIMITS)
  limit!: ListingsLimit;

  // 'recent'  -> sort:'publishedAt:desc' (mismo criterio que la portada actual)
  // 'featured'-> sort:'sortDate:desc' (max(publishedAt,bumpedAt), favorece
  //              anuncios reimpulsados). En ambos casos boostScore:desc sigue
  //              siendo la primera rankingRule de Meilisearch, así que el badge
  //              "Destacado" no depende de este campo. El mapeo a `sort` lo hace
  //              el frontend al llamar a search(); el DTO solo valida la forma.
  @IsOptional()
  @IsIn(['recent', 'featured'])
  sort?: 'recent' | 'featured';

  @IsOptional()
  @IsBoolean()
  showAllLink?: boolean;
}
