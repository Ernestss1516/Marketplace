import { IsIn } from 'class-validator';
import { BaseBlockDto } from './base-block.dto';

/**
 * COOKIES RÁFAGA 3 — el panel para cambiar o retirar el consentimiento, como bloque.
 *
 * SIN DATOS PROPIOS, igual que `separator`: lo que hace no se configura. El panel enseña
 * las categorías que existen de verdad y el estado actual del visitante, y las dos cosas
 * las decide el código —no el editor—, porque son la mecánica del consentimiento y esa es
 * fija por ley. Aquí lo único que se elige es DÓNDE ponerlo dentro de la página.
 *
 * Existe como bloque, y no incrustado a mano en la ruta de la política, porque el texto
 * legal lo escribe asesoría en el CMS (D8) y tiene que poder colocarlo donde quiera —
 * normalmente al final, después de explicar qué es cada categoría.
 */
export class CookiePreferencesBlockDto extends BaseBlockDto {
  @IsIn(['cookiePreferences'])
  type!: 'cookiePreferences';
}
