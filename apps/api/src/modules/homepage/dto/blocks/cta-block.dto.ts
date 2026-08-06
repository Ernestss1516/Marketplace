import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BaseHomeBlockDto } from './base-home-block.dto';
import { IsSafeContentUrl } from '../../../../common/validators/safe-url';

const STYLES = ['primary', 'secondary', 'outline'] as const;
export type CtaStyle = (typeof STYLES)[number];

/**
 * Botón destacado. Misma forma que el bloque `cta` del blog
 * (modules/blog/dto/blocks/cta-block.dto.ts) porque es la misma pieza de
 * producto — pero clase propia, no importada: los dos motores comparten el
 * COMPONENTE presentacional (docs/diseno-portada.md §4.0), nunca el tipo.
 *
 * Cubre el "¿Tienes algo que vender? Publica gratis" que la home pinta hoy a
 * mano ((home)/page.tsx:71-75).
 */
export class CtaHomeBlockDto extends BaseHomeBlockDto {
  @IsIn(['cta'])
  type!: 'cta';

  @IsString()
  @MaxLength(120)
  label!: string;

  // Ruta relativa ("/publicar") o URL absoluta http/https — nunca
  // javascript:/data:. Ver common/validators/safe-url.ts.
  @IsSafeContentUrl()
  href!: string;

  @IsOptional()
  @IsIn(STYLES)
  style?: CtaStyle;
}
