import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ListingTypePolicy, ListingViewMode, PriceUnit } from '@prisma/client';

/**
 * NO HAY `parentId` AQUÍ, Y ES UNA DECISIÓN, NO UN OLVIDO.
 *
 * **Re-parentar una categoría está prohibido.** Antes de la profundidad N esto
 * era una ausencia de facto; queda escrito porque ahora sostiene tres cosas:
 *
 *  1. **SEO — la razón de fondo.** La URL de una categoría ES su cadena de
 *     ancestros (`/vehiculos/coches`). Mover una rama cambiaría de golpe la URL
 *     de esa categoría Y la de todos sus descendientes, y exigiría un plan de
 *     redirects permanentes que hoy no existe. Con el padre inmutable, ninguna
 *     URL de categoría existente puede cambiar nunca: el riesgo SEO de pasar a
 *     N niveles es CERO.
 *
 *  2. **La guarda de profundidad puede ser de UNA regla.** `assertMaxDepth`
 *     comprueba solo al crear. Su molde, `NavService.assertMaxDepth`, necesita
 *     una segunda regla (un nodo movido arrastra a sus hijos por debajo del
 *     tope) precisamente porque en el nav SÍ se puede mover.
 *
 *  3. **La cadena de ancestros no puede tener ciclos.** `Category.parentId` es
 *     una auto-relación sin restricción de ciclo en la base; lo que hoy lo hace
 *     imposible es que el padre se fije al crear y no se pueda cambiar.
 *
 * Si algún día se quiere mover ramas, es un proyecto propio: la segunda regla
 * del tope, un path materializado para saber qué URLs cambiaron, y un 308 por
 * cada descendiente. Ver docs/diseno-profundidad-categorias.md §F.
 */
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  iconUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  order?: number;

  @IsOptional()
  @IsArray()
  attributeSchema?: unknown[];

  @IsOptional()
  @IsEnum(ListingTypePolicy)
  allowedListingType?: ListingTypePolicy;

  /**
   * MODERACIÓN PREVIA M1 — ver `CreateCategoryDto`. Desmarcar una categoría NO
   * exime a sus descendientes si algún ancestro sigue marcado: el pliegue es
   * monótono a propósito.
   */
  @IsOptional()
  @IsBoolean()
  requiresReview?: boolean;

  /** RÁFAGA 2 — [] = "quitar la config propia" (vuelve a heredar/default global). */
  @IsOptional()
  @IsArray()
  @IsEnum(ListingViewMode, { each: true })
  allowedViews?: ListingViewMode[];

  @IsOptional()
  @IsEnum(ListingViewMode)
  defaultView?: ListingViewMode;

  /** RP.2 — [] = "quitar la config propia" (vuelve a heredar del padre / solo
   * pago único). Volver a [] siempre AMPLÍA lo permitido, así que nunca puede
   * dejar huérfano un anuncio: el guard anti-huérfanos lo deja pasar sin más. */
  @IsOptional()
  @IsArray()
  @IsEnum(PriceUnit, { each: true })
  allowedPriceUnits?: PriceUnit[];
}
