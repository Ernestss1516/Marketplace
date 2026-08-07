import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';
import { BaseHomeBlockDto } from './base-home-block.dto';
import { CtaHomeBlockDto } from './cta-block.dto';
import { SearchHomeBlockDto } from './search-block.dto';
import { GridHomeBlockDto } from './grid-block.dto';
import { StepsHomeBlockDto } from './steps-block.dto';
import { ListingsHomeBlockDto } from './listings-block.dto';
import { CategoryCarouselHomeBlockDto } from './category-carousel-block.dto';

export type HomeBlockDto =
  | CtaHomeBlockDto
  | SearchHomeBlockDto
  | GridHomeBlockDto
  | StepsHomeBlockDto
  | ListingsHomeBlockDto
  | CategoryCarouselHomeBlockDto;

/**
 * Los 7 tipos que tendrá el motor de portada, en el orden en que las ráfagas
 * los incorporan (docs/diseno-portada.md §2.4 y §8). Esta lista es DOCUMENTAL:
 * la fuente de verdad de lo que el backend acepta es `subTypes`, más abajo.
 *
 *   RP.1  cta, search
 *   RP.4  grid, steps          ← registrados
 *   RP.5  listings, categoryCarousel  ← registrados
 *   RP.6  searchTable
 *
 * Un tipo aún no registrado se rechaza con 400 por el discriminador, que es el
 * comportamiento correcto: nada puede guardarse en `blocks` sin un DTO que lo
 * valide campo a campo.
 */
export const PLANNED_HOME_BLOCK_TYPES = [
  'search',
  'categoryCarousel',
  'grid',
  'steps',
  'cta',
  'listings',
  'searchTable',
] as const;

// Tope de bloques por portada. El blog usa 100 porque un artículo largo lo
// justifica; una portada con 30 bloques ya es una portada rota, así que aquí el
// guardarraíl se aprieta (docs/diseno-portada.md §2.5).
const MAX_BLOCKS = 30;

/**
 * ÚNICO punto donde se declaran los subtipos del motor de portada — un octavo
 * tipo se registra aquí y en su propio `*-block.dto.ts`, en ningún sitio más.
 * Empaquetado con applyDecorators (@nestjs/common) para no duplicar este bloque
 * en cada DTO que use `blocks`. Molde literal de
 * modules/blog/dto/blocks/block.dto.ts:43-70.
 *
 * `keepDiscriminatorProperty: true` es imprescindible: sin él class-transformer
 * se COME el campo `type` al instanciar el subtipo, y lo que acabaría en el Json
 * de la BD serían bloques sin discriminador — irrecuperables al leer.
 */
export function ValidHomeBlocksArray(): PropertyDecorator {
  return applyDecorators(
    IsArray(),
    ArrayMaxSize(MAX_BLOCKS),
    ValidateNested({ each: true }),
    Type(() => BaseHomeBlockDto, {
      discriminator: {
        property: 'type',
        subTypes: [
          { value: CtaHomeBlockDto, name: 'cta' },
          { value: SearchHomeBlockDto, name: 'search' },
          { value: GridHomeBlockDto, name: 'grid' },
          { value: StepsHomeBlockDto, name: 'steps' },
          { value: ListingsHomeBlockDto, name: 'listings' },
          { value: CategoryCarouselHomeBlockDto, name: 'categoryCarousel' },
        ],
      },
      keepDiscriminatorProperty: true,
    }),
  ) as PropertyDecorator;
}
