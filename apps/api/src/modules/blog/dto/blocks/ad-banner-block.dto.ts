import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BaseBlockDto } from './base-block.dto';
import { IsOwnStorageUrl, IsSafeContentUrl } from '../../../../common/validators/safe-url';

/**
 * La imagen del banner. Molde exacto de `ImageTextImageDto`: sube por
 * `POST /admin/blog/upload-image` (prefijo `blocks/`) y por eso sólo se admite una URL de
 * nuestro propio almacenamiento — nunca una pegada de fuera.
 *
 * `alt` OPCIONAL, al revés que en los bloques `image` e `imageText`, y es deliberado: allí la
 * imagen ES el contenido, así que sin texto alternativo el bloque está mal formado. Aquí la
 * imagen es una pieza publicitaria que casi siempre lleva su mensaje ENCIMA y suele venir
 * acompañada de `title`, así que el renderizador tiene de dónde sacar el texto. Cuando no hay
 * ni `alt` ni `title` se pinta `alt=""` —decorativa—, que es el tratamiento correcto: es
 * preferible a inventar un texto o a dejar que un lector de pantalla lea el nombre del
 * fichero.
 */
export class AdBannerImageDto {
  @IsOwnStorageUrl()
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  alt?: string;
}

/**
 * PUBLICIDAD EXTERNA — una pieza que el editor coloca dentro de un artículo o una página.
 *
 * NO ES `SponsoredAd`, y la distinción importa: aquella es la publicidad DE PAGO del sistema
 * (una fila propia, con fechas, categoría y su hueco reservado en `/search`), servida por el
 * backend según reglas de negocio. Esto es CONTENIDO EDITORIAL: lo coloca una persona, donde
 * quiere, dentro del `Json` de bloques del post. Reutilizar aquella entidad para esto habría
 * mezclado dos ciclos de vida que no se parecen en nada.
 *
 * COMPOSICIÓN, NO VALIDACIÓN NUEVA — igual que `imageText` en su día: la imagen es la de
 * `imageText`, el enlace es el de `cta` (`@IsSafeContentUrl`: interno `/…` o `http(s)://`,
 * nunca `javascript:` ni `data:`). Lo único que este bloque añade es el interruptor de
 * pestaña.
 *
 * SÓLO LA IMAGEN ES OBLIGATORIA. Un banner que es únicamente una imagen es un banner
 * perfectamente válido —de hecho es la forma más común—, así que título, descripción, texto
 * de botón y enlace son opcionales de verdad.
 *
 * NO HAY REGLA CRUZADA ENTRE `ctaLabel` Y `href`, y es una decisión: el botón se pinta sólo
 * cuando están los dos, y un guardado con uno solo NO se rechaza. Rechazarlo tumbaría el
 * guardado del post entero por un bloque a medio rellenar, que es un estado de trabajo
 * normal, no un dato corrupto. Quien avisa es el editor, junto al campo.
 *
 * Registrado sólo en el motor de BLOG/PÁGINAS (`ValidBlocksArray`). La portada tiene su
 * propio registro y este tipo no entra ahí.
 */
export class AdBannerBlockDto extends BaseBlockDto {
  @IsIn(['adBanner'])
  type!: 'adBanner';

  /**
   * `@IsDefined()` NO SOBRA, y es justo lo que hace obligatoria a la imagen:
   * `@ValidateNested()` sobre un valor `undefined` **no valida nada y no da error** —se salta
   * la comprobación en silencio—, así que sin esta línea un `adBanner` sin imagen pasaría el
   * DTO y se guardaría un bloque que no puede pintar nada.
   */
  @IsDefined()
  @ValidateNested()
  @Type(() => AdBannerImageDto)
  image!: AdBannerImageDto;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** El texto del botón. Sin `href` no se pinta ningún botón: ver la cabecera. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ctaLabel?: string;

  /** Interno (`/algo`) o externo (`https://…`). Mismo validador que `cta.href`. */
  @IsOptional()
  @IsSafeContentUrl()
  href?: string;

  /**
   * El interruptor de UX: si el enlace abre en una pestaña nueva.
   *
   * LO QUE ESTE CAMPO **NO** DECIDE es la seguridad. Cuando se abre en pestaña nueva, el
   * `rel="noopener noreferrer"` lo pone el sistema SIEMPRE y no es configurable: sin él la
   * página de destino recibe un `window.opener` con el que puede reescribir la nuestra
   * (tabnabbing). El interruptor elige dónde se abre; el `rel` no se elige.
   *
   * Omitido = se comporta como el resto del sitio (externo abre fuera, interno no).
   */
  @IsOptional()
  @IsBoolean()
  openInNewTab?: boolean;
}
