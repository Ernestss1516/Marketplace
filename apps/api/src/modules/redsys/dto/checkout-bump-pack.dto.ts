import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CheckoutBumpPackDto {
  @ApiProperty({ description: 'ID of the BumpPack to purchase' })
  @IsString()
  @IsNotEmpty()
  packId!: string;

  /**
   * UXV.3 (A7-flujo) — mismo contrato y misma validación que en el pack de créditos: los
   * dos vuelven al mismo `/mis-creditos/exito`, así que los dos tienen que poder decir de
   * dónde venían. Ver `return-to.ts`.
   */
  @ApiProperty({ required: false, description: 'Ruta interna a la que volver tras la compra' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  returnTo?: string;
}
