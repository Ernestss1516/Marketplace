import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { IsOwnStorageUrl } from '../../../common/validators/safe-url';
import { MAX_VIDEO_DURATION_SECONDS } from '../video-limits';

/**
 * Lo que el navegador confirma DESPUÉS de subir. El API comprueba contra el almacenamiento
 * que el objeto existe y pesa lo que dijo, y solo entonces lo enlaza al anuncio.
 */
export class ConfirmVideoDto {
  @ApiProperty({ description: 'La clave devuelta al firmar. No se acepta ninguna otra.' })
  @IsString()
  key!: string;

  /**
   * El póster que el cliente capturó, ya subido por el camino de imágenes.
   *
   * `@IsOwnStorageUrl` y no `@IsUrl`: un póster es un `<img src>` que acabará en la ficha, y
   * solo puede venir de nuestro propio almacenamiento. Es la misma regla que ya aplican las
   * imágenes de bloque.
   */
  @ApiPropertyOptional({ description: 'URL del póster (imagen ya subida).' })
  @IsOptional()
  @IsOwnStorageUrl({ message: 'El póster debe haberse subido a nuestro almacenamiento.' })
  posterUrl?: string;

  /**
   * La duración se vuelve a declarar aquí, no se arrastra desde el firmado: entre firmar y
   * confirmar no hay estado guardado a propósito (una subida abandonada no debe dejar
   * rastro), así que este es el momento en que el dato tiene dónde vivir. Se revalida contra
   * el mismo límite — ver la frontera anotada en `video-limits.ts`.
   */
  @ApiProperty({ maximum: MAX_VIDEO_DURATION_SECONDS })
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_DURATION_SECONDS, { message: 'El vídeo es más largo de lo permitido.' })
  durationSeconds!: number;
}
