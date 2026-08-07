import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BaseHomeBlockDto } from './base-home-block.dto';
import { IsOwnStorageUrl } from '../../../../common/validators/safe-url';

export class CategoryCarouselItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  categorySlug!: string;

  /**
   * IMAGEN PROPIA DEL BLOQUE, no `Category.iconUrl` (decisión 9 del diseño).
   * `iconUrl` es un icono de 48 px que además hoy se guarda como texto libre sin
   * validar; el carrusel quiere fotografías grandes, subidas por el endpoint
   * propio y restringidas a nuestro almacenamiento.
   */
  @IsOwnStorageUrl()
  imageUrl!: string;

  // Obligatorio: una imagen sin alt es un ítem mal formado, no un caso opcional.
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  alt!: string;

  /**
   * Texto visible, independiente de `Category.name`: permite acortarlo sin tocar
   * la categoría. Mismo criterio que `FooterItem.label` y `NavItem.label`
   * respecto a `Post.title`. Ausente = se usa el nombre de la categoría.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;
}

/**
 * Carrusel de categorías. **Todas** las categorías configuradas viajan en el
 * HTML servido; el island solo desplaza (docs/diseno-portada.md §4.2).
 *
 * Que un `categorySlug` exista se comprueba en el SERVICIO, no aquí: depende de
 * estado externo (la tabla Category). Y un slug que se quede colgado porque
 * alguien borró la categoría NO rompe el bloque: el renderizador lo omite
 * —doctrina "se acepta al escribir, se oculta al leer"—, porque no hay FK que
 * proteja ese borrado.
 */
export class CategoryCarouselHomeBlockDto extends BaseHomeBlockDto {
  @IsIn(['categoryCarousel'])
  type!: 'categoryCarousel';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => CategoryCarouselItemDto)
  items!: CategoryCarouselItemDto[];
}
