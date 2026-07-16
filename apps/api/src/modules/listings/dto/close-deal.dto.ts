import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/// buyerId es opcional: solo para el fallback "sin comprador registrado" en
/// PRODUCTO cuando el anuncio no tiene ningún contacto (ver ListingsService.closeDeal).
/// Un SERVICE sin buyerId es rechazado en el servicio — no tiene sentido
/// "registrar un cliente" sin identidad, a diferencia de "marcar vendido".
export class CloseDealDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  buyerId?: string;
}
