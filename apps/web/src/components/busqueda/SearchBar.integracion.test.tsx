import { render, within } from '@testing-library/react';
import { SearchBar } from './SearchBar';
import type { Category } from '@/types';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

/**
 * ══ BUSCADOR · BQ-C — LOS CUATRO CONTROLES MIDEN LO MISMO ════════════════════════════
 *
 * El punto 2 del encargo: que el buscador se lea como UNA pieza y no como cuatro cajas. Es
 * una propiedad **visual**, y lo natural sería dejársela entera a las capturas. No basta, y
 * por una razón medida:
 *
 * ⚠ **EN ESCRITORIO, UNA CAPTURA NO VE ESTE DEFECTO.** Hasta BQ-C los dos selectores
 * llevaban `md:h-full`, o sea que se estiraban hasta el alto de la fila —que fijaba el
 * campo de texto— y salían alineados en la foto aunque declararan 48 px. La mutación de
 * BQ-A lo demostró: bajarlos de 48 a 44 px puso rojas las capturas de MÓVIL y dejó
 * **verdes las de escritorio**. Una barrera que sólo mira píxeles da por bueno un
 * `md:h-full` que vuelva a esconder la incoherencia.
 *
 * Así que esto mira lo DECLARADO, que es donde vive el defecto, y las capturas miran lo
 * pintado. Las dos cosas, porque ninguna cubre a la otra.
 *
 * Es la misma clase de barrera que `anillo-de-foco.test.ts` —que comprueba una cadena de
 * clases porque ninguna captura puede ver un `:focus`— y por el mismo motivo: hay defectos
 * que no tienen fotografía.
 */

const CATEGORIAS = [
  { id: '1', slug: 'vehiculos', name: 'Vehículos', children: [{ id: '2', slug: 'coches', name: 'Coches' }] },
] as unknown as Category[];

/** Los cuatro, en el orden en que se leen. */
function controles(raiz: HTMLElement = document.body) {
  const en = within(raiz);
  return {
    categoria: en.getByRole('button', { name: /^Categoría/ }),
    provincia: en.getByRole('button', { name: /^Provincia/ }),
    texto: en.getByPlaceholderText('¿Qué estás buscando?'),
    boton: en.getByRole('button', { name: 'Buscar' }),
  };
}

/**
 * Las clases de ALTO de un control, normalizadas y ordenadas.
 *
 * Se extraen en vez de comprobarlas una a una para que el rojo diga QUÉ control se ha
 * descolgado y a qué alto se fue, en vez de un «esperaba que la cadena contuviera h-14».
 * `expect` de Jest no admite mensaje propio, así que la claridad del fallo tiene que salir
 * de la forma del dato.
 */
function alto(el: Element): string {
  return (el.className.match(/(?:^|\s)((?:md:)?h-[\w[\].%/-]+)/g) ?? [])
    .map((c) => c.trim())
    .sort()
    .join(' ');
}

function alturas(raiz?: HTMLElement): Record<string, string> {
  return Object.fromEntries(Object.entries(controles(raiz)).map(([k, el]) => [k, alto(el)]));
}

describe('SearchBar — la pieza integrada (BQ-C)', () => {
  /**
   * ⚠ EL ALTO ESPERADO ESTÁ ESCRITO A MANO, NO LEÍDO DEL PRIMER CONTROL. Comparar los
   * cuatro entre sí pasaría igual de verde si los cuatro se fueran a la vez a otro alto, y
   * entonces esto dejaría de vigilar la decisión —«los controles miden 56 y 64»— para
   * vigilar sólo que coincidan. La decisión es el valor.
   */
  const ESPERADO = 'h-14 md:h-16';

  it('los cuatro controles declaran el MISMO alto, en las dos pantallas', () => {
    render(<SearchBar categories={CATEGORIAS} />);
    expect(alturas()).toEqual({
      categoria: ESPERADO,
      provincia: ESPERADO,
      texto: ESPERADO,
      boton: ESPERADO,
    });
  });

  /**
   * `md:h-full` es el mecanismo que disimulaba: hacía que el alto de un control DEPENDIERA
   * del de otro. La prueba de arriba ya lo caza —`h-full` no es `md:h-16`—, pero esto lo
   * dice por su nombre, que es lo que leerá quien vea el rojo.
   */
  it('ninguno se estira para parecerse a los demás: fuera el md:h-full', () => {
    render(<SearchBar categories={CATEGORIAS} />);
    const estirados = Object.entries(controles())
      .filter(([, el]) => el.className.includes('h-full'))
      .map(([nombre]) => nombre);
    expect(estirados).toEqual([]);
  });

  /**
   * ⚠ ESTA PRUEBA NACE DE UN FALLO REAL DE BQ-C, Y CONVIENE QUE SE SEPA.
   *
   * Al quitar el `md:h-full` del disparador se fue con él, en la misma línea, el
   * `md:text-base` — así que el texto de los dos selectores encogió de 16 a 14 px en
   * escritorio **sin que el alto cambiara**. Las pruebas de alto de arriba lo dieron por
   * bueno, porque el alto era correcto; lo cazó la captura de escritorio, que no tenía por
   * qué haber cambiado y cambió.
   *
   * La captura sigue siendo la que manda sobre el aspecto. Esto es la red barata: la escala
   * tipográfica de los dos disparadores es la del `<select>` que sustituyeron, y si alguien
   * vuelve a llevársela por delante al tocar una cadena de clases, se pondrá rojo aquí en
   * segundos en vez de en una corrida de capturas de dos minutos.
   */
  it('los disparadores conservan la escala de texto del <select> que sustituyen', () => {
    render(<SearchBar categories={CATEGORIAS} />);
    const { categoria, provincia } = controles();
    for (const el of [categoria, provincia]) {
      expect(el.className).toContain('text-sm');
      expect(el.className).toContain('md:text-base');
    }
  });

  /** Tokenizado desde la ráfaga A del escaparate: `xl = calc(var(--radius) * 1.5)`. */
  it('los cuatro comparten el radio, que es el del modelo', () => {
    render(<SearchBar categories={CATEGORIAS} />);
    const sinRadio = Object.entries(controles())
      .filter(([, el]) => !el.className.includes('rounded-xl'))
      .map(([nombre]) => nombre);
    expect(sinRadio).toEqual([]);
  });

  /**
   * Sin categorías el disparador entero no se pinta (la API caída), y la pieza pasa a ser
   * de TRES controles — que siguen midiendo lo mismo entre sí. El guard de BQ-B, dicho
   * desde la integración.
   */
  it('sin categorías la pieza pierde un control, no la alineación', () => {
    const { container } = render(<SearchBar categories={[]} />);
    const en = within(container);
    expect(en.queryByRole('button', { name: /^Categoría/ })).toBeNull();
    expect({
      provincia: alto(en.getByRole('button', { name: /^Provincia/ })),
      texto: alto(en.getByPlaceholderText('¿Qué estás buscando?')),
      boton: alto(en.getByRole('button', { name: 'Buscar' })),
    }).toEqual({ provincia: ESPERADO, texto: ESPERADO, boton: ESPERADO });
  });
});
