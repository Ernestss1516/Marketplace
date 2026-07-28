// MEJORA UX — orden solo por flechas: crear categoría calcula `order`
// automáticamente (max(hermanos)+1, o 0 si es la primera del nivel). El
// formulario ya no tiene un input numérico de "Orden".
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminCategoriasPage from './page';
import {
  getAdminCategories,
  getSearchableKeys,
  createAdminCategory,
  type AdminCategory,
} from '@/lib/api/admin';
import { getCategoryBySlug } from '@/lib/api/categorias';

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { accessToken: 'test-token' } } }),
}));

jest.mock('@/lib/api/admin', () => ({
  getAdminCategories: jest.fn(),
  getSearchableKeys: jest.fn(),
  createAdminCategory: jest.fn(),
  updateAdminCategory: jest.fn(),
  reorderAdminCategories: jest.fn(),
  deleteAdminCategory: jest.fn(),
  getCategoryAttributeUsage: jest.fn(),
}));

jest.mock('@/lib/api/categorias', () => ({
  getCategoryBySlug: jest.fn(),
}));

const mockGetAdminCategories = getAdminCategories as jest.MockedFunction<typeof getAdminCategories>;
const mockGetSearchableKeys = getSearchableKeys as jest.MockedFunction<typeof getSearchableKeys>;
const mockCreateAdminCategory = createAdminCategory as jest.MockedFunction<typeof createAdminCategory>;
const mockGetCategoryBySlug = getCategoryBySlug as jest.MockedFunction<typeof getCategoryBySlug>;

function rootCat(overrides: Partial<AdminCategory>): AdminCategory {
  return {
    id: overrides.id ?? 'x',
    name: overrides.name ?? 'X',
    slug: overrides.slug ?? 'x',
    iconUrl: null,
    order: overrides.order ?? 0,
    attributeSchema: [],
    allowedListingType: 'BOTH',
    allowedViews: [],
    defaultView: null,
    // RP.2 — columna NOT NULL, siempre presente en las respuestas reales del
    // árbol admin (el fixture debe reflejar la forma real, no una parcial).
    allowedPriceUnits: overrides.allowedPriceUnits ?? [],
    children: overrides.children ?? [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSearchableKeys.mockResolvedValue({ keys: [] });
  mockGetCategoryBySlug.mockResolvedValue({
    id: 'x', name: 'X', slug: 'x', attributeSchema: [], allowedListingType: 'BOTH',
    allowedViews: ['LISTA', 'AMPLIADA', 'MAPA'], defaultView: 'LISTA',
    // RP.3 — findBySlug siempre resuelve este campo (nunca ausente en respuestas
    // reales); [ONE_TIME] es el efectivo de una categoría sin configurar.
    allowedPriceUnits: ['ONE_TIME'],
  });
  mockCreateAdminCategory.mockResolvedValue({
    id: 'new', name: 'Nueva', slug: 'nueva', iconUrl: null, order: 0,
    attributeSchema: [], allowedListingType: 'BOTH', allowedViews: [], defaultView: null,
    allowedPriceUnits: [],
  });
});

describe('Admin categorías — el formulario ya no tiene input numérico de Orden', () => {
  it('crear una categoría raíz: no hay campo "Orden" en el formulario', async () => {
    mockGetAdminCategories.mockResolvedValue([rootCat({ id: 'a', name: 'A', order: 1 })]);
    render(<AdminCategoriasPage />);

    await waitFor(() => screen.getByText('A'));
    fireEvent.click(screen.getByRole('button', { name: 'Nueva categoría raíz' }));

    expect(screen.queryByText('Orden')).not.toBeInTheDocument();
  });

  it('crear la PRIMERA categoría raíz (sin hermanos) → order = 0', async () => {
    mockGetAdminCategories.mockResolvedValue([]);
    render(<AdminCategoriasPage />);

    await waitFor(() => screen.getByRole('button', { name: 'Nueva categoría raíz' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nueva categoría raíz' }));

    // CategoryForm no asocia <label>/<input> con htmlFor (gap de accesibilidad
    // preexistente, fuera de alcance de esta mejora) — se selecciona por orden:
    // Nombre, Slug, Icon URL.
    const [nombreInput, slugInput] = screen.getAllByRole('textbox');
    fireEvent.change(nombreInput, { target: { value: 'Nueva' } });
    fireEvent.change(slugInput, { target: { value: 'nueva' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => expect(mockCreateAdminCategory).toHaveBeenCalled());
    const [, dto] = mockCreateAdminCategory.mock.calls[0];
    expect(dto.order).toBe(0);
  });

  it('crear una categoría raíz con hermanas existentes (orders 1, 5) → order = 6 (max+1)', async () => {
    mockGetAdminCategories.mockResolvedValue([
      rootCat({ id: 'a', name: 'A', order: 1 }),
      rootCat({ id: 'b', name: 'B', order: 5 }),
    ]);
    render(<AdminCategoriasPage />);

    await waitFor(() => screen.getByText('A'));
    fireEvent.click(screen.getByRole('button', { name: 'Nueva categoría raíz' }));

    // CategoryForm no asocia <label>/<input> con htmlFor (gap de accesibilidad
    // preexistente, fuera de alcance de esta mejora) — se selecciona por orden:
    // Nombre, Slug, Icon URL.
    const [nombreInput, slugInput] = screen.getAllByRole('textbox');
    fireEvent.change(nombreInput, { target: { value: 'Nueva' } });
    fireEvent.change(slugInput, { target: { value: 'nueva' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => expect(mockCreateAdminCategory).toHaveBeenCalled());
    const [, dto] = mockCreateAdminCategory.mock.calls[0];
    expect(dto.order).toBe(6);
  });
});

// ─── RP.2 — formatos de precio permitidos por categoría ─────────────────────

describe('Admin categorías — formatos de precio permitidos (RP.2)', () => {
  async function openCreateForm() {
    mockGetAdminCategories.mockResolvedValue([]);
    render(<AdminCategoriasPage />);
    await waitFor(() => screen.getByRole('button', { name: 'Nueva categoría raíz' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nueva categoría raíz' }));
  }

  function fillNameAndSlug() {
    const [nombreInput, slugInput] = screen.getAllByRole('textbox');
    fireEvent.change(nombreInput, { target: { value: 'Nueva' } });
    fireEvent.change(slugInput, { target: { value: 'nueva' } });
  }

  it('el formulario ofrece los 7 formatos, todos desmarcados por defecto (= "no configurado")', async () => {
    await openCreateForm();

    const group = screen.getByTestId('allowed-price-units-checkbox');
    expect(group).toBeInTheDocument();
    for (const label of [
      'Pago único', 'Al mes', 'A la semana', 'Al día', 'Por hora', 'Por unidad', 'Por sesión',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    for (const unit of [
      'one_time', 'per_month', 'per_week', 'per_day', 'per_hour', 'per_unit', 'per_session',
    ]) {
      expect(screen.getByTestId(`allowed-price-unit-${unit}`)).not.toBeChecked();
    }
  });

  it('sin marcar nada → se envía [] ("no configurado": hereda del padre o solo pago único)', async () => {
    await openCreateForm();
    fillNameAndSlug();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => expect(mockCreateAdminCategory).toHaveBeenCalled());
    const [, dto] = mockCreateAdminCategory.mock.calls[0];
    expect(dto.allowedPriceUnits).toEqual([]);
  });

  it('marcar formatos los envía en el DTO', async () => {
    await openCreateForm();
    fillNameAndSlug();

    fireEvent.click(screen.getByTestId('allowed-price-unit-per_month'));
    fireEvent.click(screen.getByTestId('allowed-price-unit-per_hour'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => expect(mockCreateAdminCategory).toHaveBeenCalled());
    const [, dto] = mockCreateAdminCategory.mock.calls[0];
    expect(dto.allowedPriceUnits).toEqual(['PER_MONTH', 'PER_HOUR']);
  });

  it('desmarcar un formato ya marcado lo quita del DTO', async () => {
    await openCreateForm();
    fillNameAndSlug();

    fireEvent.click(screen.getByTestId('allowed-price-unit-per_month'));
    fireEvent.click(screen.getByTestId('allowed-price-unit-per_hour'));
    fireEvent.click(screen.getByTestId('allowed-price-unit-per_month'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => expect(mockCreateAdminCategory).toHaveBeenCalled());
    const [, dto] = mockCreateAdminCategory.mock.calls[0];
    expect(dto.allowedPriceUnits).toEqual(['PER_HOUR']);
  });

  it('marcar formatos NO toca allowedViews ni defaultView — son ejes independientes', async () => {
    await openCreateForm();
    fillNameAndSlug();

    fireEvent.click(screen.getByTestId('allowed-price-unit-per_hour'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => expect(mockCreateAdminCategory).toHaveBeenCalled());
    const [, dto] = mockCreateAdminCategory.mock.calls[0];
    expect(dto.allowedPriceUnits).toEqual(['PER_HOUR']);
    expect(dto.allowedViews).toEqual([]);
    expect(dto.defaultView).toBeUndefined();
  });

  it('editar una categoría precarga sus formatos ya configurados', async () => {
    mockGetAdminCategories.mockResolvedValue([
      rootCat({ id: 'a', name: 'A', allowedPriceUnits: ['PER_MONTH'] }),
    ]);
    render(<AdminCategoriasPage />);

    await waitFor(() => screen.getByText('A'));
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    await waitFor(() => screen.getByTestId('allowed-price-units-checkbox'));
    expect(screen.getByTestId('allowed-price-unit-per_month')).toBeChecked();
    expect(screen.getByTestId('allowed-price-unit-one_time')).not.toBeChecked();
  });
});
