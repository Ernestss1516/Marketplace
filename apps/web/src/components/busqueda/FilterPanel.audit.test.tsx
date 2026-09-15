// AUDITORÍA DE FILTROS — dos bugs acotados:
// BUG A — acotar de un padre a una hija desde /[categoria].
//   El CONTROL ha cambiado dos veces sin que cambie lo que se protege:
//     · original: selector "Subcategoría", navegación PLANA (/coches).
//     · A1: mismo selector, URL canónica (/vehiculos/coches).
//     · A2: el selector desaparece, subsumido por el selector de CATEGORÍA completo
//       (árbol entero + "Todas"), que además permite ir a otra rama o volver a la
//       búsqueda global — cosas que antes exigían editar la URL a mano.
//   Los casos de abajo siguen cubriendo la misma garantía (acotar a una hija arrastra
//   los filtros aplicados, menos `page`), ejercida sobre el control nuevo.
// BUG B — "Condición" (estado de conservación) no aplica a SERVICE, igual que un
//   atributo appliesTo:['PRODUCT'] no aplica a un anuncio SERVICE.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { FilterPanel } from './FilterPanel';
import type { Category } from '@/types';

const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/audit-vehiculos',
  useSearchParams: () => mockSearchParams,
}));

const BASE_PROPS = {
  categories: [],
  currentFilters: {},
  activeFilterCount: 0,
};

const attr = (key: string, filterable: boolean) => ({
  key, label: key, showLabel: true, showUnit: true, filterable,
});

const TREE: Category[] = [
  {
    id: 'v', name: 'Vehículos', slug: 'audit-vehiculos',
    allAttributes: [attr('year', true)],
    children: [
      { id: 'c', name: 'Coches', slug: 'audit-coches', allAttributes: [attr('year', true), attr('fuel', true)] },
      { id: 'm', name: 'Motos', slug: 'audit-motos', allAttributes: [attr('year', true)] },
    ],
  },
  {
    id: 'i', name: 'Inmobiliaria', slug: 'audit-inmuebles',
    allAttributes: [],
    children: [{ id: 'p', name: 'Pisos', slug: 'audit-pisos', allAttributes: [attr('rooms', true)] }],
  },
];

beforeEach(() => {
  mockPush.mockClear();
  mockSearchParams = new URLSearchParams();
});

/**
 * BUSCADOR · BQ-E — EL CONTROL CAMBIA POR TERCERA VEZ, Y LO QUE PROTEGE SIGUE IGUAL.
 *
 * Donde había `selectOption` hay ahora los tres gestos del diálogo filtrable: abrir,
 * filtrar, elegir. Es el mismo cambio que BQ-B le hizo al buscador de la portada y el
 * mismo que `e2e/helpers/buscador.ts` absorbió allí — aquí lo absorbe esta función, así
 * que los seis casos de abajo siguen diciendo LO MISMO que decían con el `<select>`.
 *
 * Se TECLEA el nombre antes de elegir, y no es por ir más rápido: es lo que ejerce el
 * filtro. Una versión que abriera y pinchara daría verde con el campo de texto roto.
 */
async function elegirCategoria(nombre: string) {
  fireEvent.click(screen.getByRole('button', { name: /^Categoría/ }));
  // La capa llega por `next/dynamic`: aparece un tick después del clic.
  const dialogo = await screen.findByRole('dialog');
  fireEvent.change(within(dialogo).getByRole('combobox'), { target: { value: nombre } });

  /**
   * La fila cuyo NOMBRE es exactamente ése. No vale `getByRole('option', { name })`: el
   * nombre accesible de una fila incluye su ruta de ancestros, así que «Vehículos»
   * casaría también con sus descendientes. Mismo cuidado que en `CategoriaDialogo.test`.
   */
  const fila = within(dialogo)
    .getAllByRole('option')
    .find((li) => li.querySelector('span')?.textContent === nombre);
  if (!fila) throw new Error(`No hay ninguna fila llamada «${nombre}»`);
  fireEvent.pointerDown(fila);
}

/** El disparador del diálogo de categoría, o `null` si la sección no se pinta. */
const disparadorCategoria = () => screen.queryByRole('button', { name: /^Categoría/ });

describe('BUG A / A2 — selector de categoría', () => {
  it('sin árbol → no se muestra la sección', () => {
    render(<FilterPanel {...BASE_PROPS} />);
    expect(disparadorCategoria()).not.toBeInTheDocument();
  });

  /**
   * PROFUNDIDAD N — RÁFAGA 2: ESTRUCTURA ACTUALIZADA, misma intención.
   *
   * Este caso comprobaba la forma de `<optgroup>`: un grupo por raíz con una
   * opción «Todo en Vehículos» dentro. Esa forma se sustituyó porque **el
   * estándar HTML no permite anidar `<optgroup>`**, así que un `<select>` nativo
   * sólo puede agrupar DOS niveles y no hay manera de representar cuatro.
   *
   * BQ-E: y ya no hay `<select>` en absoluto. Cada categoría es una FILA del diálogo
   * filtrable, con su nombre a la izquierda y su ruta de ancestros atenuada al lado —el
   * mismo reparto que la portada—. Lo que este caso verifica —que están la opción global,
   * las raíces y las hijas de cualquier rama— no cambia; cambia dónde están.
   */
  it('con árbol → "Todas las categorías" + cada categoría, con su ruta al lado', async () => {
    render(<FilterPanel {...BASE_PROPS} categories={TREE} />);
    expect(disparadorCategoria()).toBeInTheDocument();

    fireEvent.click(disparadorCategoria()!);
    const dialogo = await screen.findByRole('dialog');
    const filas = within(dialogo)
      .getAllByRole('option')
      .map((li) => li.querySelector('span')?.textContent);

    expect(filas).toEqual([
      'Todas las categorías',
      'Vehículos',
      'Coches',
      'Motos',
      'Inmobiliaria',
      // A2 — lo que antes era inalcanzable desde aquí: otra rama del árbol.
      'Pisos',
    ]);
    // La ruta se MUESTRA, aunque no sea lo que se busca (§3.3 del diseño).
    expect(within(dialogo).getByRole('option', { name: /Pisos/ })).toHaveTextContent('Inmobiliaria');
  });

  it('elegir una hija navega a /{padre}/{hija} — la URL canónica, no la plana', async () => {
    render(<FilterPanel {...BASE_PROPS} categories={TREE} currentCategorySlug="audit-vehiculos" />);
    await elegirCategoria('Coches');
    expect(mockPush).toHaveBeenCalledWith('/audit-vehiculos/audit-coches');
  });

  it('elegir una hija ARRASTRA los filtros ya aplicados en la URL (menos page)', async () => {
    mockSearchParams = new URLSearchParams('province=Madrid&page=3');
    render(<FilterPanel {...BASE_PROPS} categories={TREE} currentCategorySlug="audit-vehiculos" />);
    await elegirCategoria('Motos');
    expect(mockPush).toHaveBeenCalledWith('/audit-vehiculos/audit-motos?province=Madrid');
  });

  // A2 — los tránsitos nuevos, imposibles con el selector de "Subcategoría".
  it('elegir "Todas las categorías" vuelve a la búsqueda global conservando filtros', async () => {
    mockSearchParams = new URLSearchParams('q=x&province=Madrid');
    render(<FilterPanel {...BASE_PROPS} categories={TREE} currentCategorySlug="audit-coches" />);
    await elegirCategoria('Todas las categorías');
    expect(mockPush).toHaveBeenCalledWith('/busqueda?q=x&province=Madrid');
  });

  it('LA TRAMPA: al saltar a otra rama, el atributo que no vale allí se CAE (evita el 400)', async () => {
    mockSearchParams = new URLSearchParams('fuel=diesel&q=x');
    render(<FilterPanel {...BASE_PROPS} categories={TREE} currentCategorySlug="audit-coches" />);
    await elegirCategoria('Pisos');
    expect(mockPush).toHaveBeenCalledWith('/audit-inmuebles/audit-pisos?q=x');
  });

  /**
   * BQ-E — LA CATEGORÍA ACTUAL SE LEE EN EL DISPARADOR, y es lo que sustituye al
   * `toHaveValue` del `<select>`. Además del texto visible va en el nombre accesible: un
   * `aria-label` PISA el contenido del botón, así que sin eso un lector de pantalla
   * anunciaría «Categoría» y nunca «Coches» — que es justo lo que un `<select>` sí decía.
   */
  it('el disparador dice en qué categoría estás', () => {
    render(<FilterPanel {...BASE_PROPS} categories={TREE} currentCategorySlug="audit-coches" />);
    expect(screen.getByRole('button', { name: 'Categoría: Coches' })).toBeInTheDocument();
  });

  /**
   * Y sin categoría dice lo que decía la primera `<option>` del `<select>`: bajo una
   * sección ya titulada «CATEGORÍA», repetir «Categoría» no informa de nada. El nombre
   * ACCESIBLE sigue siendo «Categoría» —el contrato de los localizadores—, que es
   * justamente lo que este caso comprueba al pedirlo por ese nombre.
   */
  it('en la búsqueda global el disparador dice «Todas las categorías»', () => {
    render(<FilterPanel {...BASE_PROPS} categories={TREE} />);
    expect(screen.getByRole('button', { name: 'Categoría' })).toHaveTextContent(
      'Todas las categorías',
    );
  });
});

describe('BUG B — "Condición" no aplica a servicios', () => {
  it('sin contexto de servicio → "Condición" se muestra (comportamiento por defecto)', () => {
    render(<FilterPanel {...BASE_PROPS} />);
    expect(screen.getByText('Condición')).toBeInTheDocument();
  });

  it('allowedListingType=SERVICE_ONLY → "Condición" se oculta', () => {
    render(<FilterPanel {...BASE_PROPS} allowedListingType="SERVICE_ONLY" />);
    expect(screen.queryByText('Condición')).not.toBeInTheDocument();
  });

  it('categoría mixta pero currentFilters.type=SERVICE → "Condición" se oculta', () => {
    render(<FilterPanel {...BASE_PROPS} allowedListingType="BOTH" currentFilters={{ type: 'SERVICE' }} />);
    expect(screen.queryByText('Condición')).not.toBeInTheDocument();
  });

  it('currentFilters.type=PRODUCT → "Condición" se sigue mostrando', () => {
    render(<FilterPanel {...BASE_PROPS} currentFilters={{ type: 'PRODUCT' }} />);
    expect(screen.getByText('Condición')).toBeInTheDocument();
  });

  it('elegir "Servicios" en Tipo limpia condition además de fijar type (mismo patrón que el wizard)', () => {
    mockSearchParams = new URLSearchParams('condition=NEW');
    render(<FilterPanel {...BASE_PROPS} currentFilters={{ condition: 'NEW' }} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Servicios' }));
    const [url] = mockPush.mock.calls[0];
    expect(url).toBe('/audit-vehiculos?type=SERVICE');
  });

  it('elegir "Productos" en Tipo NO toca condition', () => {
    mockSearchParams = new URLSearchParams('condition=NEW&type=SERVICE');
    render(<FilterPanel {...BASE_PROPS} currentFilters={{ condition: 'NEW', type: 'SERVICE' }} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Productos' }));
    const [url] = mockPush.mock.calls[0];
    expect(url).toBe('/audit-vehiculos?condition=NEW&type=PRODUCT');
  });
});
