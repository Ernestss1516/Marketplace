/**
 * E8 — EL TEMA, RESUELTO PARA UN CORREO. Fichero PURO, sin DI.
 *
 * ── LA SEGUNDA VÍA DE RENDERIZADO, Y ES INEVITABLE ──────────────────────────────────
 *
 * En la web el tema viaja como variables CSS (`--primary: 221.2 83.2% 53.3%`) y Tailwind
 * las envuelve en `hsl(var(--primary))`. **En un correo nada de eso existe**: no hay
 * variables CSS, no hay hoja de estilos (Gmail recorta el `<style>` del `<head>` de forma
 * inconsistente) y Outlook de escritorio pinta con el motor de Word. Así que el mismo tema
 * se resuelve otra vez, aquí, a **valores literales hexadecimales que se escriben inline**.
 *
 * El §7.3 del diseño lo da por inevitable y este fichero es toda la duplicación que
 * supone: los valores siguen saliendo de `EstiloService`, no se copia ninguno.
 *
 * ── QUÉ LLEGA DEL TEMA Y QUÉ NO ─────────────────────────────────────────────────────
 *
 *  · SÍ: **el color principal** (y la letra que va encima, que la elige la máquina por
 *    contraste, no el admin) y **la rampa neutra** —lienzo, panel, texto, texto atenuado y
 *    borde—, que es lo que hace que el correo se lea como el sitio.
 *  · SÍ: **el logo público de la instancia**, el que ya sirve `BrandingService`.
 *  · NO: **la tipografía.** No hay fuentes personalizadas fiables en correo — una
 *    `@font-face` la ignoran Gmail y Outlook, y el `<link>` a Google Fonts sólo lo
 *    respetan Apple Mail y poco más. Se cae a una pila del sistema. **La personalidad del
 *    modelo llega al correo PARCIAL, siempre**, y está dicho en el §7.3.
 *  · NO: los ejes de movimiento, elevación y trazo. No tienen traducción en un correo.
 *
 * ── EL MODO OSCURO DE LOS CLIENTES ──────────────────────────────────────────────────
 *
 * Gmail y Outlook reinvierten colores por su cuenta y de forma impredecible, y no se puede
 * controlar. Por eso el marco es claro y de contraste alto: sobrevive a la inversión
 * legible aunque no idéntico. Es el mismo criterio que el §7.3 fija para Outlook de
 * escritorio — degrada, no se rompe.
 */
import type { Tokens } from '../../../modules/estilo/estilo.constants';
import { tripleteAHex } from '../../../modules/estilo/color';

export interface TemaCorreo {
  /** El color de marca: el botón de acción y poco más. */
  readonly primary: string;
  /** La letra que va sobre el principal. La elige el contraste, nunca el admin. */
  readonly primaryTexto: string;
  /** El lienzo de la página del correo (la rampa atenuada). */
  readonly fondo: string;
  /** El panel donde va el contenido. */
  readonly panel: string;
  /** El texto base. */
  readonly texto: string;
  /** El texto secundario: el pie, la URL escrita bajo el botón. */
  readonly textoSuave: string;
  /** El trazo: el marco del panel y el separador del pie. */
  readonly borde: string;
  /** El logo público de la instancia, o `null` si no hay ninguno configurado. */
  readonly logoUrl: string | null;
}

/**
 * EL TEMA DE FÁBRICA: el Modelo 0, en hexadecimal.
 *
 * No es una paleta paralela ni una decisión nueva — son los mismos tokens del Modelo 0
 * pasados por `tripleteAHex`, y `correo-render.spec.ts` lo comprueba token a token para
 * que no puedan separarse. Existe porque un correo **no puede depender de que la base
 * responda**: si la consulta del tema falla, sale con esto, que es exactamente lo que
 * saldría en una instancia recién desplegada. Doctrina de siempre: degrada, nunca rompe.
 */
export const TEMA_CORREO_DE_FABRICA: TemaCorreo = {
  primary: '#2563eb',
  primaryTexto: '#f8fafc',
  fondo: '#f1f5f9',
  panel: '#ffffff',
  texto: '#020817',
  textoSuave: '#64748b',
  borde: '#e2e8f0',
  logoUrl: null,
};

/**
 * La pila de respaldo. Se escribe entera en cada `style` porque no hay `<style>` donde
 * declararla una vez, y porque un cliente que no herede la fuente del `<body>` la pediría
 * a su valor por defecto, que en Outlook es Times New Roman.
 *
 * SIN COMILLAS en `Segoe UI`, y es a propósito: el valor viaja dentro de un atributo
 * `style="..."` que el serializador escapa entero, así que unas comillas simples saldrían
 * como `&#39;` — legal, pero una entidad de más que cada cliente tiene que decodificar
 * bien. CSS admite nombres de familia de varias palabras sin comillar mientras cada
 * palabra sea un identificador válido, que es el caso.
 */
export const PILA_TIPOGRAFICA =
  '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif';

/**
 * De los tokens resueltos al tema del correo.
 *
 * Cada token que no se pueda leer cae a su valor de fábrica **por separado**: un modelo con
 * un token raro pierde ese token, no el correo entero.
 */
export function temaCorreo(tokens: Tokens, logoUrl: string | null): TemaCorreo {
  const hex = (nombre: string, porDefecto: string): string => {
    const v = tokens[nombre];
    return (typeof v === 'string' ? tripleteAHex(v) : null) ?? porDefecto;
  };

  return {
    primary: hex('primary', TEMA_CORREO_DE_FABRICA.primary),
    primaryTexto: hex('primary-foreground', TEMA_CORREO_DE_FABRICA.primaryTexto),
    // El lienzo del correo es la superficie ATENUADA, no `background`: un panel blanco
    // sobre un fondo blanco no se ve como panel, y el marco es lo que da la forma.
    fondo: hex('muted', TEMA_CORREO_DE_FABRICA.fondo),
    panel: hex('background', TEMA_CORREO_DE_FABRICA.panel),
    texto: hex('foreground', TEMA_CORREO_DE_FABRICA.texto),
    textoSuave: hex('muted-foreground', TEMA_CORREO_DE_FABRICA.textoSuave),
    borde: hex('border', TEMA_CORREO_DE_FABRICA.borde),
    logoUrl,
  };
}
