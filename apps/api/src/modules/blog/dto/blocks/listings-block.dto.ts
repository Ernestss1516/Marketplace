import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { BaseBlockDto } from './base-block.dto';

// Primer bloque DINÁMICO del sistema — no guarda contenido, guarda una
// CONSULTA (categorySlug + limit + sort) que se resuelve contra
// SearchService.search() en cada render (ver BlogService.assertListingsBlocksValid
// para las reglas cruzadas: categorySlug debe existir, máximo N bloques
// `listings` por página — ambas dependen de estado fuera del propio DTO, así
// que viven en el service, mismo criterio que assertTableBlocksValid).
export const LISTINGS_BLOCK_LIMITS = [4, 6, 8, 12] as const;
export type ListingsBlockLimit = (typeof LISTINGS_BLOCK_LIMITS)[number];

export class ListingsBlockDto extends BaseBlockDto {
  @IsIn(['listings'])
  type!: 'listings';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  categorySlug!: string;

  @IsIn(LISTINGS_BLOCK_LIMITS)
  limit!: ListingsBlockLimit;

  // 'recent' -> sort:'publishedAt:desc' (mismo criterio que la portada);
  // 'featured' -> sort:'sortDate:desc' (sortDate = max(publishedAt,
  // bumpedAt), favorece anuncios recién re-impulsados). En ambos casos
  // boostScore:desc sigue siendo la primera rankingRule de Meilisearch (ver
  // RF.8 en estado-tecnico.md) — el badge "Destacado" no depende de este
  // campo, ya gana siempre. Mapeo hecho en el frontend (lib/api/busqueda) al
  // llamar a search(), no aquí — el DTO solo valida la forma.
  @IsOptional()
  @IsIn(['recent', 'featured'])
  sort?: 'recent' | 'featured';

  @IsOptional()
  @IsBoolean()
  showAllLink?: boolean;
}
