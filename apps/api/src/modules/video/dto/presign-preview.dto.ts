import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';
import { ALLOWED_PREVIEW_MIME_TYPES, MAX_PREVIEW_BYTES } from '../video-limits';

/**
 * PÓSTER ANIMADO P1 — lo que el navegador declara antes de subir el SPRITE.
 *
 * Molde de `PresignVideoDto`, y el mismo reparto: aquí los límites producen un 400 con el
 * detalle por campo, y el servicio los vuelve a comprobar porque un DTO no es un guard de
 * negocio.
 *
 * NO HAY `durationSeconds`: el sprite no dura nada. Es una imagen fija — los cinco
 * fotogramas están uno al lado del otro, y quien los pone en movimiento es el CSS.
 */
export class PresignPreviewDto {
  @ApiProperty({ description: 'Anuncio cuyo vídeo se está previsualizando.' })
  @IsString()
  listingId!: string;

  /**
   * Sólo WebP o JPEG, que es lo que `canvas.toBlob` sabe emitir. **Ningún formato animado**:
   * un GIF aquí convertiría el artefacto en algo que anima solo, siempre y en todas partes,
   * y con eso se perderían el control del hover y la decisión del móvil.
   */
  @ApiProperty({ enum: ALLOWED_PREVIEW_MIME_TYPES, example: 'image/webp' })
  @IsIn(ALLOWED_PREVIEW_MIME_TYPES as unknown as string[], {
    message: 'La previsualización debe ser una imagen WebP o JPEG.',
  })
  contentType!: string;

  @ApiProperty({ maximum: MAX_PREVIEW_BYTES, description: 'Tamaño exacto en bytes.' })
  @IsInt()
  @Min(1)
  @Max(MAX_PREVIEW_BYTES, { message: 'La previsualización supera el tamaño máximo permitido.' })
  sizeBytes!: number;
}
