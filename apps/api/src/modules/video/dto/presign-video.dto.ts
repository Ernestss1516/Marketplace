import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';
import {
  ALLOWED_VIDEO_MIME_TYPES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
} from '../video-limits';

/**
 * Lo que el navegador declara ANTES de subir. El API valida esto y solo entonces firma.
 *
 * Los límites se aplican con los decoradores además de en el servicio: aquí producen un 400
 * con el detalle por campo (que es lo que la interfaz necesita para señalar cuál falla), y
 * el servicio vuelve a comprobarlos porque un DTO no es un guard de negocio.
 */
export class PresignVideoDto {
  @ApiProperty({ description: 'Anuncio al que se le añade el vídeo.' })
  @IsString()
  listingId!: string;

  @ApiProperty({ enum: ALLOWED_VIDEO_MIME_TYPES, example: 'video/mp4' })
  @IsIn(ALLOWED_VIDEO_MIME_TYPES as unknown as string[], {
    message: 'Solo se admite vídeo MP4 (H.264).',
  })
  contentType!: string;

  @ApiProperty({ maximum: MAX_VIDEO_BYTES, description: 'Tamaño exacto en bytes.' })
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_BYTES, { message: 'El vídeo supera el tamaño máximo permitido.' })
  sizeBytes!: number;

  @ApiProperty({ maximum: MAX_VIDEO_DURATION_SECONDS })
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_DURATION_SECONDS, { message: 'El vídeo es más largo de lo permitido.' })
  durationSeconds!: number;
}
