import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BaseBlockDto } from './base-block.dto';
import { IsSafeContentUrl } from '../../../../common/validators/safe-url';

const STYLES = ['primary', 'secondary', 'outline'] as const;
export type CtaStyle = (typeof STYLES)[number];

export class CtaBlockDto extends BaseBlockDto {
  @IsIn(['cta'])
  type!: 'cta';

  @IsString()
  @MaxLength(100)
  label!: string;

  @IsSafeContentUrl()
  href!: string;

  @IsOptional()
  @IsIn(STYLES)
  style?: CtaStyle;

  /**
   * ── ESCAPARATE C · LA CAJA ────────────────────────────────────────────────
   *
   * Gemelos de los del `cta` de PORTADA, y declarados aparte por lo mismo que
   * toda esta clase: los dos motores comparten el componente presentacional,
   * nunca el tipo. Con `title` el bloque se pinta como caja a color de marca;
   * sin él, como el botón centrado de siempre.
   *
   * Opcionales para que todo artículo ya guardado siga validando: los bloques
   * viven en un Json y ninguna migración los va a rellenar.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}
