import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CheckoutCreditsPackDto {
  @ApiProperty({ description: 'ID of the CreditPack to purchase' })
  @IsString()
  @IsNotEmpty()
  packId!: string;

  /**
   * UXV.3 (A7-flujo) — a dónde devolver al usuario tras la compra, cuando salió a comprar
   * desde una acción que no pudo pagar. Solo se admiten los destinos internos de
   * `return-to.ts`; cualquier otro valor se descarta EN SILENCIO (ver allí por qué la
   * comprobación es una allowlist y no un `startsWith('/')`). Omitirlo deja la página de
   * éxito genérica de siempre.
   */
  @ApiProperty({ required: false, description: 'Ruta interna a la que volver tras la compra' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  returnTo?: string;
}
