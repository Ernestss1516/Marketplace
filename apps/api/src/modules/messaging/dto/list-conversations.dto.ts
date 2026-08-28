import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * La cara por la que se mira a una persona en sus conversaciones.
 *
 * `ambos` es el defecto porque es lo que responde a «enséñame su mensajería»; los
 * otros dos existen para las dos listas separadas de la ficha de usuario, que las
 * pide una por una precisamente para poder etiquetarlas.
 */
export const PAPELES = ['comprador', 'vendedor', 'ambos'] as const;
export type PapelConversacion = (typeof PAPELES)[number];

export class ListConversationsDto {
  /** Uno de los dos, nunca los dos a la vez (lo comprueba el controlador). */
  @IsOptional()
  @IsString()
  listingId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsIn(PAPELES)
  papel?: PapelConversacion;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  /**
   * Tope de 100: esto lo consume una ficha de staff, no un exportador. Sin techo,
   * un `perPage=100000` sobre un vendedor con miles de hilos sería una consulta
   * cara servida a quien no la necesita.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  perPage?: number = 20;
}
