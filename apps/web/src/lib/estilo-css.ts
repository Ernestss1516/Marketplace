/**
 * ⚠ EL FILTRO DE LO QUE ENTRA EN UN `<style>`.
 *
 * Un bloque de estilo es una superficie de inyección: un valor que contenga `}` o
 * `</style` puede cerrar la regla y escribir CSS arbitrario. Tres de estos valores
 * salen, en origen, de lo que un admin escribe en un formulario.
 *
 * El backend ya valida la forma (triplete HSL o hexadecimal, por DTO) y la normaliza,
 * así que esto es la SEGUNDA barrera, no la única — y se pone igual, porque el coste
 * es una expresión regular y lo que protege es la plantilla de todas las páginas.
 *
 * Se permite exactamente lo que los valores legítimos necesitan: dígitos y letras para
 * `150ms` y `ease-in-out`, `%` y `.` para los tripletes, `#` para los hexadecimales,
 * paréntesis y comas para `cubic-bezier(...)` y `rgb(... / 0.1)`, `/` para esa misma
 * barra, y guiones para `var(--font-inter)`. Todo lo demás —`;`, `{`, `}`, `<`, `@`,
 * comillas— queda fuera, y el token se descarta en vez de sanearse a medias: un valor
 * que no reconocemos es un valor en el que no se confía.
 */
const VALOR_SEGURO = /^[\w\s.,%#()/-]+$/;
const NOMBRE_SEGURO = /^[a-z0-9-]+$/;

/**
 * De un mapa de tokens a un bloque CSS.
 *
 * SELECTOR `html:root` Y NO `:root`, y es una corrección a la nota (a) del §3.4 del
 * diseño, que decía que este bloque debía ir «antes que el CSS de Tailwind». Está al
 * revés: las custom properties de igual especificidad las gana **la última
 * declarada**, así que un bloque anterior a `globals.css` perdería siempre.
 *
 * Y depender del orden sería frágil de todos modos —Next decide dónde coloca el CSS y
 * los `<style>` de un Server Component—, así que se resuelve por ESPECIFICIDAD, que no
 * depende del orden: `html:root` (0,1,1) gana a `:root` (0,1,0) esté donde esté.
 *
 * Efecto secundario deseable: si el backend no responde y no se emite nada,
 * `globals.css` sigue declarando el Modelo 0 completo. El respaldo no es una copia de
 * los valores en el frontend — es el CSS que ya estaba.
 */
function declaraciones(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .filter(([n, v]) => NOMBRE_SEGURO.test(n) && typeof v === 'string' && VALOR_SEGURO.test(v))
    .map(([n, v]) => `--${n}:${v}`)
    .join(';');
}

/**
 * E5 — LAS ZONAS, Y POR QUÉ SUS BLOQUES NO NECESITAN GANAR NINGUNA GUERRA DE
 * ESPECIFICIDAD.
 *
 * El bloque base va en `html:root` porque compite con `globals.css`, que declara lo
 * mismo en el mismo elemento; ahí la especificidad decide. Los de zona no compiten con
 * nadie: se aplican a un `<div>` DESCENDIENTE, y una custom property declarada en un
 * descendiente manda en su subárbol sin más — la especificidad sólo compara reglas que
 * apuntan al MISMO elemento. Por eso basta con `[data-zona="x"]`, sin artificios.
 *
 * De ahí sale también que las zonas ANIDEN solas: el blog vive dentro del público, así
 * que hereda todo lo del público y sólo cambia lo suyo. No hay que declarar la herencia
 * en ninguna parte; es cómo funciona la cascada.
 *
 * Se emite SÓLO lo que cada zona ajusta —el backend ya devuelve únicamente eso—, así
 * que una zona sin diferenciar no produce ni una regla. Es lo que permite montar el
 * mecanismo entero sin mover un píxel.
 */
export function bloqueDeEstilo(
  tokens: Record<string, string>,
  zonas?: Record<string, Record<string, string>>,
): string {
  const base = declaraciones(tokens);
  let css = base ? `html:root{${base}}` : '';

  for (const [zona, ajustes] of Object.entries(zonas ?? {})) {
    if (!NOMBRE_SEGURO.test(zona) || !ajustes) continue;
    const d = declaraciones(ajustes);
    if (d) css += `[data-zona="${zona}"]{${d}}`;
  }

  return css;
}
