import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Confirmar es comprobar QUÉ ATERRIZÓ de verdad, no mover nada.
 *
 * Sólo la clave: el servidor la valida contra el prefijo temporal de quien llama y mira el
 * objeto con `head`. Todo lo demás (tamaño, tipo) se lee del almacenamiento — preguntárselo
 * al cliente sería volver a confiar en lo que ya se estaba comprobando.
 */
export class ConfirmBlockMediaDto {
  @ApiProperty({ example: 'blocks-videos/tmp/ckuser123/6f1c….mp4' })
  @IsString()
  key!: string;
}
