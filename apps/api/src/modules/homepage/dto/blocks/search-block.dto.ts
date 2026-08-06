import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { BaseHomeBlockDto } from './base-home-block.dto';

// Tope de chips "Populares" bajo el buscador. La home usa hoy 6
// (POPULAR_CATEGORY_COUNT en (home)/page.tsx:18); 12 es el techo de cordura.
export const MAX_POPULAR_CATEGORIES = 12;

/**
 * Buscador de portada. NO guarda datos: guarda la decisión de mostrarlo y sus
 * adornos. El árbol de categorías lo carga el Server Component de la página y
 * se lo pasa por props a SearchBar, que ya lo recibe así hoy
 * (apps/web/src/components/busqueda/SearchBar.tsx:14) — el bloque no dispara
 * ninguna consulta propia.
 *
 * `eyebrow` y los chips de categorías populares viven AQUÍ y no en el hero
 * (docs/diseno-portada.md §4.1): son vecindad del buscador, no del titular.
 * Hoy están hardcodeados en (home)/page.tsx:48-50 y :56-69.
 */
export class SearchHomeBlockDto extends BaseHomeBlockDto {
  @IsIn(['search'])
  type!: 'search';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  eyebrow?: string;

  @IsOptional()
  @IsBoolean()
  showPopularCategories?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_POPULAR_CATEGORIES)
  popularCount?: number;
}
