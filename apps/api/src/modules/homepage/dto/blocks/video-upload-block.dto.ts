import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BaseHomeBlockDto } from './base-home-block.dto';
import { IsOwnStorageUrl } from '../../../../common/validators/safe-url';

/**
 * VÍDEO SUBIDO en la portada. Mismos campos y mismas reglas que el del blog
 * (`modules/blog/dto/blocks/video-upload-block.dto.ts`), clase propia.
 *
 * COPIA DELIBERADA, igual que `BaseHomeBlockDto` lo es de `BaseBlockDto`: importar el DTO
 * del blog ataría los dos motores por el discriminador de class-transformer, que es
 * exactamente lo que el diseño de la portada evita (docs/diseno-portada.md §2.4). Son dos
 * uniones sin ningún solape, y compartir un subtipo entre ellas las juntaría por primera vez
 * para ahorrar doce líneas.
 *
 * LO QUE SÍ SE COMPARTE es lo que de verdad hace el trabajo: el endpoint de subida
 * (`admin/block-media`), el prefijo `blocks-videos/` y el pase de promoción. Ver
 * `docs/diseno-video-bloque.md` §8.
 */
export class VideoUploadHomeBlockDto extends BaseHomeBlockDto {
  @IsIn(['videoUpload'])
  type!: 'videoUpload';

  /**
   * La URL COMPLETA, no la clave — barrera B-3. Ver el comentario del DTO del blog: la
   * limpieza de huérfanas recorre el `Json` buscando cadenas que sean URLs nuestras, así que
   * guardar aquí una clave desnuda la dejaría ciega en silencio.
   */
  @IsOwnStorageUrl()
  url!: string;

  @IsOptional()
  @IsOwnStorageUrl()
  poster?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  caption?: string;
}
