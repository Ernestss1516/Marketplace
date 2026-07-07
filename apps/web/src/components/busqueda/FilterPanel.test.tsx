// RÁFAGA 4 (búsqueda y ficha) — ocultar el filtro "Tipo" cuando la categoría
// fija ya no permite ambos tipos.
import { render, screen } from '@testing-library/react';
import { FilterPanel } from './FilterPanel';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/categoria-test',
  useSearchParams: () => new URLSearchParams(),
}));

const BASE_PROPS = {
  categories: [],
  currentFilters: {},
  activeFilterCount: 0,
};

describe('FilterPanel — filtro "Tipo" según la política de la categoría', () => {
  it('sin allowedListingType (p. ej. /busqueda) → el filtro "Tipo" se muestra (sin cambio)', () => {
    render(<FilterPanel {...BASE_PROPS} />);
    expect(screen.getByText('Tipo')).toBeInTheDocument();
    expect(screen.getByText('Productos')).toBeInTheDocument();
    expect(screen.getByText('Servicios')).toBeInTheDocument();
  });

  it('allowedListingType=BOTH → el filtro "Tipo" se muestra', () => {
    render(<FilterPanel {...BASE_PROPS} allowedListingType="BOTH" />);
    expect(screen.getByText('Tipo')).toBeInTheDocument();
  });

  it('allowedListingType=PRODUCT_ONLY → el filtro "Tipo" se oculta', () => {
    render(<FilterPanel {...BASE_PROPS} allowedListingType="PRODUCT_ONLY" />);
    expect(screen.queryByText('Tipo')).not.toBeInTheDocument();
    expect(screen.queryByText('Productos')).not.toBeInTheDocument();
  });

  it('allowedListingType=SERVICE_ONLY → el filtro "Tipo" se oculta', () => {
    render(<FilterPanel {...BASE_PROPS} allowedListingType="SERVICE_ONLY" />);
    expect(screen.queryByText('Tipo')).not.toBeInTheDocument();
  });
});
