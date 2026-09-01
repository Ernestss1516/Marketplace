import { IsIn, IsInt, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  ALLOWED_BLOCK_POSTER_MIME_TYPES,
  MAX_BLOCK_POSTER_BYTES,
} from '../block-media-limits';

/**
 * El póster del vídeo de bloque. Molde literal del DTO del vídeo, con su propia lista de
 * tipos y su propio tope.
 *
 * VA POR EL MISMO CAMINO PREFIRMADO QUE EL VÍDEO, y no por `POST /admin/blog/upload-image`,
 * aunque sea una imagen pequeña que cabría de sobra en una petición. El motivo no es el
 * tamaño: es que así **nace bajo `blocks-videos/tmp/`** y el mismo pase de promoción que
 * mueve el vídeo lo mueve a él, sin una línea extra —el pase recorre el `Json` entero, no
 * una lista de campos—. Un póster subido y nunca guardado se caduca solo, igual que el
 * vídeo, en vez de quedarse para siempre como se queda hoy cualquier imagen de bloque.
 */
export class PresignBlockPosterDto {
  @ApiProperty({ enum: ALLOWED_BLOCK_POSTER_MIME_TYPES, example: 'image/webp' })
  @IsIn(ALLOWED_BLOCK_POSTER_MIME_TYPES as readonly string[], {
    message: 'El póster debe ser una imagen WebP o JPEG.',
  })
  contentType!: string;

  @ApiProperty({ maximum: MAX_BLOCK_POSTER_BYTES, example: 40_000 })
  @IsInt()
  @Min(1)
  @Max(MAX_BLOCK_POSTER_BYTES)
  sizeBytes!: number;
}
