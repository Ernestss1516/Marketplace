import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ValidHomeBlocksArray, type HomeBlockDto } from './blocks';

/**
 * TOPE DE OPCIONES ROTATIVAS DEL HERO = 6.
 *
 * No es un límite estético: es la consecuencia directa de resolver la rotación
 * en CSS puro (docs/diseno-portada.md §3.2). El mecanismo necesita una regla
 * `@keyframes` ESTÁTICA por cada N soportado —porque un selector de keyframe no
 * admite `calc()`— y hay exactamente cinco escritas a mano en globals.css
 * (`hero-rot-2` … `hero-rot-6`). Subir este número SIN añadir su regla dejaría
 * el título congelado en la primera opción.
 *
 * Si algún día se cambia el mecanismo, este tope se levanta aquí y allí a la vez.
 */
export const MAX_HERO_ROTATING_OPTIONS = 6;

/** Milisegundos por opción: por debajo es ilegible, por encima parece rota. */
export const MIN_HERO_ROTATION_MS = 1500;
export const MAX_HERO_ROTATION_MS = 10000;

/**
 * Cuerpo de `PATCH /admin/homepage`. Reemplazo COMPLETO de la configuración
 * (hero + array de bloques), no un parche campo a campo: los bloques no son
 * filas, son un Json de una fila, así que el editor manda siempre el objeto
 * entero — mismo contrato que el submit de PostForm en el blog, que envía el
 * array `blocks` completo y no una petición por bloque.
 *
 * Consecuencia deliberada: omitir `blocks` NO conserva los que hubiera; el
 * campo es obligatorio para que "vaciar la portada" sea siempre un acto
 * explícito y nunca el efecto colateral de un cuerpo incompleto.
 */
export class UpdateHomepageDto {
  // ── Hero ──────────────────────────────────────────────────────────────────

  /** Parte fija del <h1>. Obligatoria: la portada siempre tiene un <h1> real. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  heroStaticTitle!: string;

  /**
   * Opciones que rotan tras la parte fija. Ausente o [] = título estático, sin
   * animación (caso soportado, no un error).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_HERO_ROTATING_OPTIONS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(60, { each: true })
  heroRotatingOptions?: string[];

  @IsOptional()
  @IsInt()
  @Min(MIN_HERO_ROTATION_MS)
  @Max(MAX_HERO_ROTATION_MS)
  heroRotationMs?: number;

  /** Texto plano, no markdown (docs/diseno-portada.md §2.2). Ausente = se borra. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  heroSubtitle?: string;

  // ── Bloques ───────────────────────────────────────────────────────────────

  @ValidHomeBlocksArray()
  blocks!: HomeBlockDto[];
}
