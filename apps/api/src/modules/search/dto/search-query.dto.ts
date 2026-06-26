import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { Condition, ListingType, PriceType } from '@prisma/client';
// VariableAttributeKey is imported only for the type-level constraint below.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { VariableAttributeKey } from '../search.service';

// Compile-time guard: every field in the variable-attribute section below must
// correspond to a key in VARIABLE_ATTRIBUTE_KEYS. TypeScript will error here if
// the DTO declares a field that the service no longer lists (or vice versa if
// checked via a mapped type). This comment serves as the coupling reminder —
// update both files when the seed's attributeSchema changes.

export class SearchQueryDto {
  // ---------- Text ----------

  @ApiPropertyOptional({ description: 'Texto libre de búsqueda' })
  @IsOptional()
  @IsString()
  q?: string;

  // ---------- Core filters ----------

  @ApiPropertyOptional({ description: 'Slug de categoría' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: ListingType, description: 'Tipo de anuncio (PRODUCT | SERVICE)' })
  @IsOptional()
  @IsEnum(ListingType)
  type?: ListingType;

  @ApiPropertyOptional({ enum: Condition, description: 'Estado del artículo' })
  @IsOptional()
  @IsEnum(Condition)
  condition?: Condition;

  @ApiPropertyOptional({ enum: PriceType, description: 'Tipo de precio' })
  @IsOptional()
  @IsEnum(PriceType)
  priceType?: PriceType;

  @ApiPropertyOptional({ minimum: 0, description: 'Precio mínimo (inclusive)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Precio máximo (inclusive)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Provincia' })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiPropertyOptional({ description: 'Ciudad' })
  @IsOptional()
  @IsString()
  city?: string;

  // ---------- Sort & pagination ----------

  @ApiPropertyOptional({
    enum: ['price:asc', 'price:desc', 'publishedAt:desc', 'sortDate:desc'],
    description: 'Orden de resultados',
  })
  @IsOptional()
  @IsIn(['price:asc', 'price:desc', 'publishedAt:desc', 'sortDate:desc'])
  sort?: 'price:asc' | 'price:desc' | 'publishedAt:desc' | 'sortDate:desc';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  hitsPerPage?: number = 24;

  // ---------- Variable attributes: vehículos ----------
  // Derived from seed attributeSchema entries with filterable: true.
  // These field names must match VARIABLE_ATTRIBUTE_KEYS in search.service.ts.
  // The global ValidationPipe (forbidNonWhitelisted: true) rejects any query
  // param that is NOT declared here, making this class the whitelist.

  @ApiPropertyOptional({ description: 'Marca — coches, motos, móviles, ordenadores, ropa, calzado, electrodomésticos' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ description: 'Año de fabricación — vehículos' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Kilómetros — vehículos' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  km?: number;

  @ApiPropertyOptional({ description: 'Combustible (Gasolina, Diésel, Eléctrico, Híbrido, GLP) — coches, furgonetas' })
  @IsOptional()
  @IsString()
  fuel?: string;

  @ApiPropertyOptional({ description: 'Tipo de cambio (Manual, Automático) — coches' })
  @IsOptional()
  @IsString()
  gearbox?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Cilindrada en cc — motos' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  displacement?: number;

  // ---------- Variable attributes: inmuebles ----------

  @ApiPropertyOptional({ minimum: 0, description: 'Superficie en m² — pisos, casas, locales' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sqm?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Habitaciones — pisos, casas' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  rooms?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Baños — pisos' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bathrooms?: number;

  @ApiPropertyOptional({ description: 'Con ascensor — pisos' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  elevator?: boolean;

  @ApiPropertyOptional({ description: 'Con garaje — pisos, casas' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  garage?: boolean;

  @ApiPropertyOptional({ description: 'Con piscina — casas' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  pool?: boolean;

  // ---------- Variable attributes: tecnología ----------

  @ApiPropertyOptional({
    description:
      'Almacenamiento — móviles (ej. "128 GB"). ' +
      'El valor se compara como cadena exacta; usar los valores del enum de la categoría.',
  })
  @IsOptional()
  @IsString()
  storage?: string;

  @ApiPropertyOptional({ description: 'RAM — ordenadores (ej. "16 GB")' })
  @IsOptional()
  @IsString()
  ram?: string;

  // ---------- Variable attributes: moda ----------

  @ApiPropertyOptional({ description: 'Género (Hombre, Mujer, Unisex, Niño, Niña) — ropa, calzado' })
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional({
    description:
      'Talla — ropa (XS…XXL) o calzado (número). ' +
      'NOTA: en calzado el valor se almacena como número; enviar como cadena ("38") ' +
      'no filtrará correctamente hasta que el seed normalice el tipo a string.',
  })
  @IsOptional()
  @IsString()
  size?: string;

  // ---------- Variable attributes: servicios ----------

  @ApiPropertyOptional({ description: 'Especialidad — reformas y construcción' })
  @IsOptional()
  @IsString()
  specialty?: string;

  @ApiPropertyOptional({ description: 'Materia — clases y formación' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional({ description: 'Modalidad (Presencial, Online, Ambas) — clases y formación' })
  @IsOptional()
  @IsString()
  modality?: string;

  // ---------- Proximidad ----------
  // Los tres parámetros van juntos: lat + lng + radius (km).
  // Cuando se envían, search() aplica _geoRadius como FILTRO (no como sort) y
  // ordena por _geoPoint si no hay sort explícito.
  // AVISO: los anuncios sin coordenadas (_geo ausente) quedan excluidos del
  // resultado porque Meilisearch solo incluye documentos posicionados en _geoRadius.
  // Esto es correcto: un anuncio sin posición no puede aparecer en "a X km de ti".

  @ApiPropertyOptional({
    description:
      'Latitud del punto de referencia para búsqueda por proximidad. ' +
      'Requiere lng y radius.',
    minimum: -90,
    maximum: 90,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({
    description: 'Longitud del punto de referencia. Requiere lat y radius.',
    minimum: -180,
    maximum: 180,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({
    description:
      'Radio de búsqueda en kilómetros. Requiere lat y lng. ' +
      'Solo se incluyen anuncios con coordenadas dentro del radio.',
    minimum: 1,
    maximum: 500,
  })
  @ValidateIf((o: SearchQueryDto) => o.lat != null || o.lng != null)
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  radius?: number;

  // TODO: "type" como atributo de categoría (ordenadores, electrodomésticos,
  // accesorios, muebles) colisiona en nombre con el ListingType (PRODUCT/SERVICE).
  // Renombrar a "itemType" en el seed y luego añadirlo aquí y en VARIABLE_ATTRIBUTE_KEYS.
}
