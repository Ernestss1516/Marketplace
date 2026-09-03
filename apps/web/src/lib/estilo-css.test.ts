import { bloqueDeEstilo } from './estilo-css';

/**
 * E4a — LAS DOS COSAS QUE NINGUNA CAPTURA PUEDE PROBAR.
 *
 * Las 47 imágenes demuestran que el Modelo 0 se ve igual. No pueden demostrar qué pasa
 * cuando el backend no responde (no hay pantalla de eso) ni qué pasa si un valor trae
 * caracteres que cierran la regla CSS (no llegaría a pintarse: rompería el bloque).
 */

describe('El respaldo: sin tema no se emite nada', () => {
  /**
   * LA PROPIEDAD QUE HACE INNECESARIO UN MAPA DE RESERVA EN EL FRONTEND. Si el backend
   * cae, el layout no emite bloque, y entonces manda `globals.css`, que sigue
   * declarando el Modelo 0 completo desde E0-E3. El respaldo no es una copia de la
   * paleta —que podría divergir— es el CSS que ya estaba.
   */
  it('un mapa vacío produce cadena vacía, no una regla huérfana', () => {
    expect(bloqueDeEstilo({})).toBe('');
  });

  it('si todos los valores son inválidos tampoco se emite regla', () => {
    expect(bloqueDeEstilo({ primary: '}<script>' })).toBe('');
  });
});

describe('El bloque usa `html:root`, que gana por especificidad y no por orden', () => {
  /**
   * Es una corrección a la nota (a) del §3.4 del diseño, que pedía emitir este bloque
   * «antes que el CSS de Tailwind». Está al revés —entre custom properties de igual
   * especificidad gana la última declarada—, y además depender del orden sería frágil
   * porque Next decide dónde coloca el CSS. `html:root` (0,1,1) gana a `:root` (0,1,0)
   * esté donde esté.
   */
  it('el selector es html:root', () => {
    expect(bloqueDeEstilo({ primary: '221.2 83.2% 53.3%' })).toBe(
      'html:root{--primary:221.2 83.2% 53.3%}',
    );
  });
});

describe('El filtro de inyección en el bloque de estilo', () => {
  /**
   * Tres de estos valores salen, en origen, de un formulario de admin. El backend ya
   * valida la forma por DTO, así que esto es la segunda barrera — y se pone igual,
   * porque un `<style>` es una superficie de inyección y lo que protege es la
   * plantilla de TODAS las páginas.
   *
   * Se DESCARTA el token entero en vez de sanearlo a medias: un valor que no
   * reconocemos es un valor en el que no se confía.
   */
  it.each([
    ['cierre de regla', '}html{display:none'],
    ['cierre de etiqueta', '</style><script>alert(1)</script>'],
    ['punto y coma', 'red;background:url(x)'],
    ['import', '@import url(evil.css)'],
    ['comilla', 'red"'],
  ])('descarta un valor con %s', (_caso, valor) => {
    expect(bloqueDeEstilo({ primary: valor, secondary: '0 0% 0%' })).toBe(
      'html:root{--secondary:0 0% 0%}',
    );
  });

  it('descarta nombres de variable que no sean sencillos', () => {
    expect(bloqueDeEstilo({ 'primary}html{x': '0 0% 0%' })).toBe('');
  });

  /**
   * Y a la vez tiene que DEJAR PASAR todo lo que los valores legítimos usan, o el
   * filtro se comería el tema entero: paréntesis y comas de `cubic-bezier`, la barra
   * de `rgb(... / 0.1)`, el `#` de los hexadecimales, los guiones de `var(--x)`.
   */
  it.each([
    ['triplete HSL', '221.2 83.2% 53.3%'],
    ['hexadecimal', '#fbbf24'],
    ['sombra con barra', '0 1px 3px 0 rgb(0 0 0 / 0.1)'],
    ['curva de bézier', 'cubic-bezier(0.4, 0, 0.2, 1)'],
    ['referencia a otra variable', 'var(--font-inter)'],
    ['duración', '150ms'],
    ['palabra clave', 'ease-in-out'],
  ])('deja pasar %s', (_caso, valor) => {
    expect(bloqueDeEstilo({ x: valor })).toBe(`html:root{--x:${valor}}`);
  });
});
