import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * FICHA DE USUARIO — U2: retirar un Pro concedido a mano.
 *
 * Sólo el motivo: qué se revoca lo decide el servidor (los entitlements PRO
 * manuales vigentes de ese usuario), no el cliente. Pedirle un id al llamante
 * abriría la puerta a revocar el entitlement de un Pro DE PAGO desde una ruta de
 * administración, que es otra cosa muy distinta y no es lo que esto hace.
 */
export class RevokeProDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
