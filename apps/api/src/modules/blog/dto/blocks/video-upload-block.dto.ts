import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BaseBlockDto } from './base-block.dto';
import { IsOwnStorageUrl } from '../../../../common/validators/safe-url';

/**
 * VÍDEO SUBIDO — un vídeo alojado por nosotros, al contrario que `VideoBlockDto`, que
 * incrusta uno de YouTube o Vimeo.
 *
 * LOS DOS CONVIVEN Y SON TIPOS DISTINTOS, no un tipo con una bifurcación dentro. Un embed
 * guarda `{provider, videoId}` y se renderiza como un `<iframe>` de un tercero; esto guarda
 * una URL nuestra y se renderiza como un `<video>`. No comparten ni un campo ni una línea de
 * validación, así que unirlos habría significado un DTO con todos los campos opcionales —y
 * ninguna forma de exigir los que de verdad hacen falta en cada caso—.
 *
 * Ver `docs/diseno-video-bloque.md` §3.3.
 */
export class VideoUploadBlockDto extends BaseBlockDto {
  @IsIn(['videoUpload'])
  type!: 'videoUpload';

  /**
   * LA URL COMPLETA, NO LA CLAVE, y es una restricción de verdad (barrera B-3).
   *
   * La limpieza de huérfanas encuentra lo que hay que borrar recorriendo el `Json` entero y
   * quedándose con toda cadena que sea una URL nuestra (`ownUrlsDeep`) — **no mira campos**,
   * precisamente para no quedarse corta el día que se añade un tipo de bloque, que es hoy.
   * Guardar aquí la clave desnuda, o la URL partida, o una plantilla que se componga al
   * renderizar, dejaría a ese recorrido ciego: al quitar el bloque, el `.mp4` se quedaría en
   * el bucket para siempre **y en silencio**.
   *
   * `@IsOwnStorageUrl` y no `@IsSafeContentUrl`: un vídeo de bloque sólo puede venir de
   * nuestro propio endpoint de subida. Y aquí importa más que en las imágenes — un
   * `<video src>` NO pasa por `remotePatterns` de next/image, así que este validador es la
   * ÚNICA restricción de origen que tiene (ver el comentario de `isOwnStorageUrl`).
   */
  @IsOwnStorageUrl()
  url!: string;

  /**
   * Opcional de verdad: la captura del fotograma se hace en el navegador y puede fallar
   * (un formato que no sabe decodificar), y **un póster roto no debe impedir publicar**.
   * Misma asimetría que el sprite del vídeo Pro: sin póster se vive, sin vídeo no.
   */
  @IsOptional()
  @IsOwnStorageUrl()
  poster?: string;

  /**
   * El pie. Es la pieza editorial que el bloque de embed no tiene y que un vídeo dentro de
   * un artículo casi siempre quiere.
   *
   * NO HAY `alt`, al contrario que el bloque `image`: `<video>` no tiene ese atributo —no es
   * un `<img>`—, así que un `alt` aquí sería un campo que sólo sirve para rellenarse.
   */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  caption?: string;
}
