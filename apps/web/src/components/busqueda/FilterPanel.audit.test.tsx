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
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('BUG A / A2 — selector de categoría', () => {
  it('sin árbol → no se muestra la sección', () => {
    render(<FilterPanel {...BASE_PROPS} />);
    expect(screen.queryByText('Categoría')).not.toBeInTheDocument();
  });

  it('con árbol → "Todas las categorías" + cada raíz y cada hija', () => {
    render(<FilterPanel {...BASE_PROPS} categories={TREE} />);
    expect(screen.getByText('Categoría')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Todas las categorías' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Todo en Vehículos' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Coches' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Motos' })).toBeInTheDocument();
    // A2 — lo que antes era inalcanzable desde aquí: otra rama del árbol.
    expect(screen.getByRole('option', { name: 'Pisos' })).toBeInTheDocument();
  });

  it('elegir una hija navega a /{padre}/{hija} — la URL canónica, no la plana', () => {
    render(<FilterPanel {...BASE_PROPS} categories={TREE} currentCategorySlug="audit-vehiculos" />);
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'audit-coches' } });
    expect(mockPush).toHaveBeenCalledWith('/audit-vehiculos/audit-coches');
  });

  it('elegir una hija ARRASTRA los filtros ya aplicados en la URL (menos page)', () => {
    mockSearchParams = new URLSearchParams('province=Madrid&page=3');
    render(<FilterPanel {...BASE_PROPS} categories={TREE} currentCategorySlug="audit-vehiculos" />);
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'audit-motos' } });
    expect(mockPush).toHaveBeenCalledWith('/audit-vehiculos/audit-motos?province=Madrid');
  });

  // A2 — los tránsitos nuevos, imposibles con el selector de "Subcategoría".
  it('elegir "Todas las categorías" vuelve a la búsqueda global conservando filtros', () => {
    mockSearchParams = new URLSearchParams('q=x&province=Madrid');
    render(<FilterPanel {...BASE_PROPS} categories={TREE} currentCategorySlug="audit-coches" />);
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: '' } });
    expect(mockPush).toHaveBeenCalledWith('/busqueda?q=x&province=Madrid');
  });

  it('LA TRAMPA: al saltar a otra rama, el atributo que no vale allí se CAE (evita el 400)', () => {
    mockSearchParams = new URLSearchParams('fuel=diesel&q=x');
    render(<FilterPanel {...BASE_PROPS} categories={TREE} currentCategorySlug="audit-coches" />);
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'audit-pisos' } });
    expect(mockPush).toHaveBeenCalledWith('/audit-inmuebles/audit-pisos?q=x');
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
