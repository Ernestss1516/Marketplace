// AUDITORÍA DE FILTROS — dos bugs acotados:
// BUG A — selector de subcategoría en /[categoria] (antes: sin forma de acotar
//   de un padre a una hija; navegación PLANA).
// BUG B — "Condición" (estado de conservación) no aplica a SERVICE, igual que un
//   atributo appliesTo:['PRODUCT'] no aplica a un anuncio SERVICE.
import { fireEvent, render, screen } from '@testing-library/react';
import { FilterPanel } from './FilterPanel';

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

beforeEach(() => {
  mockPush.mockClear();
  mockSearchParams = new URLSearchParams();
});

describe('BUG A — selector de subcategoría', () => {
  const subcategories = [
    { slug: 'audit-coches', name: 'Coches' },
    { slug: 'audit-motos', name: 'Motos' },
  ];

  it('sin subcategories (o vacío) → no se muestra la sección', () => {
    render(<FilterPanel {...BASE_PROPS} />);
    expect(screen.queryByText('Subcategoría')).not.toBeInTheDocument();
  });

  it('con subcategories → se muestra un select con "Todas" + cada hija', () => {
    render(<FilterPanel {...BASE_PROPS} subcategories={subcategories} />);
    expect(screen.getByText('Subcategoría')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Todas' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Coches' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Motos' })).toBeInTheDocument();
  });

  // A1 (URLs anidadas) — cambia la FORMA de la URL emitida, no el comportamiento:
  // la subcategoría es siempre hija de la categoría fija de la página, así que su
  // URL canónica lleva el slug del padre delante.
  it('elegir una hija navega a /{padre}/{hija} — la URL canónica, no la plana', () => {
    render(
      <FilterPanel
        {...BASE_PROPS}
        subcategories={subcategories}
        subcategoryParentSlug="audit-vehiculos"
      />,
    );
    fireEvent.change(screen.getByLabelText('Acotar a una subcategoría'), {
      target: { value: 'audit-coches' },
    });
    expect(mockPush).toHaveBeenCalledWith('/audit-vehiculos/audit-coches');
  });

  it('elegir una hija ARRASTRA los filtros ya aplicados en la URL (menos page)', () => {
    mockSearchParams = new URLSearchParams('province=Madrid&page=3');
    render(
      <FilterPanel
        {...BASE_PROPS}
        subcategories={subcategories}
        subcategoryParentSlug="audit-vehiculos"
      />,
    );
    fireEvent.change(screen.getByLabelText('Acotar a una subcategoría'), {
      target: { value: 'audit-motos' },
    });
    const [url] = mockPush.mock.calls[0];
    expect(url).toBe('/audit-vehiculos/audit-motos?province=Madrid');
  });

  it('sin subcategoryParentSlug cae a la URL plana (que el catch-all redirige), nunca a una rota', () => {
    render(<FilterPanel {...BASE_PROPS} subcategories={subcategories} />);
    fireEvent.change(screen.getByLabelText('Acotar a una subcategoría'), {
      target: { value: 'audit-coches' },
    });
    expect(mockPush).toHaveBeenCalledWith('/audit-coches');
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
