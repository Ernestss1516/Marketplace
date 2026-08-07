import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BaseHomeBlockDto } from './base-home-block.dto';

export const SEARCH_TABLE_COLUMNS = [2, 3, 4] as const;
export type SearchTableColumns = (typeof SEARCH_TABLE_COLUMNS)[number];

/**
 * Un par categoría+provincia de la pestaña "combinaciones".
 *
 * `province` SE VALIDA SOLO EN LA FORMA, y es una decisión escrita
 * (docs/diseno-portada.md §4.7): `PROVINCIAS` es una constante del FRONTEND —el
 * backend no tiene la lista y filtra `province` como coincidencia exacta contra
 * Meilisearch—, así que validarla aquí exigiría una segunda copia de 52 cadenas
 * que mantener sincronizada a mano. En su lugar: el editor ofrece un `<select>`
 * (un typo es casi imposible de introducir) y el RENDERIZADOR omite la
 * combinación cuya provincia no esté en la lista. Misma doctrina "se acepta al
 * escribir, se oculta al leer" que el nav y que los slugs colgados del carrusel.
 */
export class SearchTableComboDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  categorySlug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  province!: string;
}

export abstract class BaseSearchTableTabDto {
  @IsIn(['locations', 'categories', 'combos'])
  kind!: 'locations' | 'categories' | 'combos';

  /** Texto de la pestaña. Es lo que el usuario pulsa, así que es obligatorio. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label!: string;
}

/** Las 52 provincias. No se configura nada más: la lista es la lista. */
export class LocationsTabDto extends BaseSearchTableTabDto {
  @IsIn(['locations'])
  kind!: 'locations';
}

export class CategoriesTabDto extends BaseSearchTableTabDto {
  @IsIn(['categories'])
  kind!: 'categories';

  /** Incluir también las subcategorías del árbol, no solo las raíces. */
  @IsOptional()
  @IsBoolean()
  includeChildren?: boolean;
}

export class CombosTabDto extends BaseSearchTableTabDto {
  @IsIn(['combos'])
  kind!: 'combos';

  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => SearchTableComboDto)
  items!: SearchTableComboDto[];
}

/**
 * Tabla de búsquedas: hasta tres pestañas de enlaces internos a búsquedas.
 *
 * Es el bloque con más valor SEO del motor, y de ahí su propiedad central: el
 * contenido de TODAS las pestañas activas viaja en el HTML servido. La pestaña
 * inactiva se sirve con `hidden`, no desmontada — por eso el renderizador NO usa
 * Radix Tabs, que desmonta el panel inactivo y sacaría esos enlaces del HTML.
 */
export class SearchTableHomeBlockDto extends BaseHomeBlockDto {
  @IsIn(['searchTable'])
  type!: 'searchTable';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  // 1..3: son tres clases de pestaña y no tiene sentido repetir ninguna. Que no
  // se repitan lo comprueba el servicio (regla cruzada sobre el array).
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => BaseSearchTableTabDto, {
    discriminator: {
      property: 'kind',
      subTypes: [
        { value: LocationsTabDto, name: 'locations' },
        { value: CategoriesTabDto, name: 'categories' },
        { value: CombosTabDto, name: 'combos' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  tabs!: (LocationsTabDto | CategoriesTabDto | CombosTabDto)[];

  @IsOptional()
  @IsInt()
  @IsIn(SEARCH_TABLE_COLUMNS)
  columns?: SearchTableColumns;
}
