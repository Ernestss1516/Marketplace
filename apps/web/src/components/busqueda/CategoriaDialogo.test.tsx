import { fireEvent, render, screen, within } from '@testing-library/react';
import { CategoriaDialogo } from './CategoriaDialogo';
import type { Category } from '@/types';

/**
 * ══ BUSCADOR · BQ-B — EL DIÁLOGO DE CATEGORÍA ════════════════════════════════════════
 *
 * Dos cosas se afirman aquí, y las dos son decisiones de producto convertidas en rojo de
 * CI:
 *
 *  1. **LOS CUATRO NIVELES SON ALCANZABLES.** El `<select>` al que sustituye pintaba dos
 *     —el estándar HTML no permite anidar `<optgroup>`—, así que una categoría de nivel 3
 *     o 4 no aparecía. No daba error: simplemente no estaba.
 *  2. **EL FILTRO BUSCA EN EL NOMBRE, NO EN LA RUTA.** Es lo que evita que teclear «veh»
 *     devuelva la rama entera de Vehículos y el filtro deje de filtrar justo en el caso
 *     más común (§3.3 del diseño).
 */
const ARBOL = [
  {
    id: '1',
    slug: 'vehiculos',
    name: 'Vehículos',
    children: [
      {
        id: '2',
        slug: 'coches',
        name: 'Coches',
        children: [
          {
            id: '3',
            slug: 'deportivos',
            name: 'Deportivos',
            children: [{ id: '4', slug: 'clasicos', name: 'Clásicos' }],
          },
        ],
      },
    ],
  },
  { id: '5', slug: 'inmobiliaria', name: 'Inmobiliaria' },
] as unknown as Category[];

async function montar() {
  const onElegir = jest.fn();
  render(<CategoriaDialogo categories={ARBOL} valor="" onElegir={onElegir} />);
  fireEvent.click(screen.getByRole('button', { name: /Categoría/ }));
  // La capa llega por `next/dynamic`: aparece un tick después del clic.
  return { onElegir, dialogo: await screen.findByRole('dialog') };
}

const campoDe = (dialogo: HTMLElement) => within(dialogo).getByRole('combobox');

const etiquetas = (dialogo: HTMLElement) =>
  within(dialogo)
    .getAllByRole('option')
    .map((li) => li.querySelector('span')?.textContent ?? '');

/**
 * La fila cuyo NOMBRE es exactamente ése.
 *
 * No vale `getByRole('option', { name })`: el nombre accesible de una fila incluye su
 * contexto, así que «Vehículos» casaría también con Coches, Deportivos y Clásicos —que lo
 * llevan en la ruta— y la consulta sería ambigua. Es el precio de mostrar la ruta, y se
 * paga aquí y no ensuciando el componente.
 */
function fila(dialogo: HTMLElement, nombre: string): HTMLElement {
  const encontrada = within(dialogo)
    .getAllByRole('option')
    .find((li) => li.querySelector('span')?.textContent === nombre);
  if (!encontrada) throw new Error(`No hay ninguna fila llamada «${nombre}»`);
  return encontrada;
}

describe('CategoriaDialogo — los cuatro niveles', () => {
  it('ofrece TODAS las categorías, incluidas las de nivel 3 y 4', async () => {
    const { dialogo } = await montar();
    expect(etiquetas(dialogo)).toEqual([
      'Todas las categorías',
      'Vehículos',
      'Coches',
      'Deportivos',
      'Clásicos',
      'Inmobiliaria',
    ]);
  });

  it('una categoría de nivel 4 se puede elegir y emite su slug', async () => {
    const { dialogo, onElegir } = await montar();
    fireEvent.change(campoDe(dialogo), { target: { value: 'clasicos' } });
    fireEvent.pointerDown(fila(dialogo, 'Clásicos'));
    expect(onElegir).toHaveBeenCalledWith('clasicos');
  });

  /**
   * El `<select>` ofrecía «Todo en Vehículos» además de cada hija, y hay que conservarlo:
   * `categoryPath` contiene la cadena entera de ancestros, así que elegir un padre devuelve
   * también a sus descendientes. Con la lista aplanada eso vale para CUALQUIER nivel.
   */
  it('un padre sigue siendo elegible, igual que una hoja', async () => {
    const { dialogo, onElegir } = await montar();
    fireEvent.pointerDown(fila(dialogo, 'Vehículos'));
    expect(onElegir).toHaveBeenCalledWith('vehiculos');
  });

  it('muestra la ruta de ancestros como contexto, no dentro del nombre', async () => {
    const { dialogo } = await montar();
    const clasicos = fila(dialogo, 'Clásicos');
    expect(clasicos.querySelector('span')).toHaveTextContent('Clásicos');
    expect(clasicos).toHaveTextContent('Vehículos › Coches › Deportivos');
  });

  /** Lo que sustituye al literal «Todo en Vehículos» (decisión 6), y dice además cuánto. */
  it('anota cuántas subcategorías cuelgan, y no lo hace en las hojas', async () => {
    const { dialogo } = await montar();
    expect(fila(dialogo, 'Vehículos')).toHaveTextContent('y 3 subcategorías');
    expect(fila(dialogo, 'Deportivos')).toHaveTextContent('y 1 subcategoría');
    expect(fila(dialogo, 'Clásicos')).not.toHaveTextContent('subcategor');
  });
});

describe('CategoriaDialogo — el filtro busca en el NOMBRE', () => {
  /**
   * ⚠ LA BARRERA DE LA DECISIÓN 4. Si `buscable` fuera la ruta completa, «veh» devolvería
   * Vehículos, Coches, Deportivos y Clásicos —todos la llevan en su path— y con un árbol
   * real serían decenas de filas.
   */
  it('«veh» devuelve Vehículos y NO su rama entera', async () => {
    const { dialogo } = await montar();
    fireEvent.change(campoDe(dialogo), { target: { value: 'veh' } });
    expect(etiquetas(dialogo)).toEqual(['Todas las categorías', 'Vehículos']);
  });

  it('«coch» encuentra la hija, con su padre visible al lado', async () => {
    const { dialogo } = await montar();
    fireEvent.change(campoDe(dialogo), { target: { value: 'coch' } });
    expect(etiquetas(dialogo)).toEqual(['Todas las categorías', 'Coches']);
    expect(fila(dialogo, 'Coches')).toHaveTextContent('Vehículos');
  });

  it('ignora los acentos: «clasicos» encuentra «Clásicos»', async () => {
    const { dialogo } = await montar();
    fireEvent.change(campoDe(dialogo), { target: { value: 'clasicos' } });
    expect(etiquetas(dialogo)).toEqual(['Todas las categorías', 'Clásicos']);
  });

  /**
   * La red: quien teclea la ruta a mano tampoco se queda sin nada. Sólo actúa cuando el
   * nombre no casa con NADA, así que no desdibuja la prueba de arriba.
   *
   * Y sí devuelve el SUBÁRBOL de esa ruta —Coches y lo que cuelga de ella—, que es lo
   * correcto: quien escribe «vehiculos coches» ha nombrado una rama, no un nodo. Lo que
   * importa es que la coincidencia más ajustada quede ARRIBA, y de eso se encarga el
   * desempate por longitud.
   */
  it('quien teclea la ruta entera no se queda sin resultados', async () => {
    const { dialogo } = await montar();
    fireEvent.change(campoDe(dialogo), { target: { value: 'vehiculos coches' } });
    expect(etiquetas(dialogo)).toEqual([
      'Todas las categorías',
      'Coches',
      'Deportivos',
      'Clásicos',
    ]);
  });
});
