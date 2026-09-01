import { IsIn, IsInt, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  ALLOWED_BLOCK_VIDEO_MIME_TYPES,
  MAX_BLOCK_VIDEO_BYTES,
} from '../block-media-limits';

/**
 * Lo que el editor declara ANTES de subir, para que el servidor firme.
 *
 * NO LLEVA `durationSeconds`, al revés que el vídeo Pro: aquí no hay límite de duración, y
 * pedir un dato que no se usa para nada sería inventar una comprobación (ver
 * `block-media-limits.ts`).
 *
 * NO LLEVA NINGÚN ID DE RECURSO. Un vídeo de bloque no pertenece a ninguna fila cuando se
 * sube: nace suelto y sólo lo referencia el `Json` del post o de la portada cuando alguien
 * guarda. El dueño de la subida es el USUARIO, y va en la clave temporal (§3.2).
 */
export class PresignBlockVideoDto {
  @ApiProperty({ enum: ALLOWED_BLOCK_VIDEO_MIME_TYPES, example: 'video/mp4' })
  @IsIn(ALLOWED_BLOCK_VIDEO_MIME_TYPES as readonly string[], {
    message: 'Solo se admite vídeo MP4 (H.264).',
  })
  contentType!: string;

  /**
   * El tamaño declarado. Se valida aquí y **entra en la firma**: a partir de ese momento
   * deja de depender de que el cliente diga la verdad.
   */
  @ApiProperty({ maximum: MAX_BLOCK_VIDEO_BYTES, example: 8_000_000 })
  @IsInt()
  @Min(1)
  @Max(MAX_BLOCK_VIDEO_BYTES)
  sizeBytes!: number;
}
