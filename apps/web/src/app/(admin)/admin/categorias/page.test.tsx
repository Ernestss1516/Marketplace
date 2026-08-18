// MEJORA UX — orden solo por flechas: crear categoría calcula `order`
// automáticamente (max(hermanos)+1, o 0 si es la primera del nivel). El
// formulario ya no tiene un input numérico de "Orden".
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminCategoriasPage from './page';
import {
  getAdminCategories,
  getSearchableKeys,
  createAdminCategory,
  updateAdminCategory,
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
const mockUpdateAdminCategory = updateAdminCategory as jest.MockedFunction<typeof updateAdminCategory>;
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
    // M5 — columna NOT NULL con default `false`, igual que allowedPriceUnits:
    // siempre presente en el árbol admin real desde que el select la incluye.
    requiresReview: overrides.requiresReview ?? false,
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
    allowedPriceUnits: [], requiresReview: false,
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

// ─── M5 — la marca de moderación previa por categoría ────────────────────────
//
// El nivel CATEGORÍA del disparador (M1) tenía motor y endpoint pero ningún
// control: el moderador no podía encenderlo desde el backoffice. Estos casos
// cubren las dos mitades del control — que ESCRIBE y LEE la marca, y que no
// MIENTE sobre la herencia monótona, que es la trampa propia de este campo.

describe('Admin categorías — moderación previa (M5)', () => {
  async function abrirEdicionDe(nombre: string, indice: number) {
    render(<AdminCategoriasPage />);
    await waitFor(() => screen.getByText(nombre));
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[indice]);
    });
    await waitFor(() => screen.getByTestId('requires-review-checkbox'));
  }

  it('una categoría sin marca: la casilla nace desmarcada y EDITABLE', async () => {
    mockGetAdminCategories.mockResolvedValue([rootCat({ id: 'a', name: 'A' })]);
    await abrirEdicionDe('A', 0);

    const casilla = screen.getByTestId('requires-review-checkbox');
    expect(casilla).not.toBeChecked();
    expect(casilla).toBeEnabled();
    expect(screen.queryByTestId('requires-review-inherited')).not.toBeInTheDocument();
  });

  it('LEE la marca guardada: una categoría marcada abre con la casilla marcada', async () => {
    // Si `getCategories()` dejara de traer `requiresReview`, el fixture no podría
    // ni tenerlo y el panel pintaría siempre desmarcado — ver el e2e gemelo
    // «el backoffice puede LEER la marca» en moderacion-previa.e2e-spec.ts.
    mockGetAdminCategories.mockResolvedValue([
      rootCat({ id: 'a', name: 'A', requiresReview: true }),
    ]);
    await abrirEdicionDe('A', 0);

    const casilla = screen.getByTestId('requires-review-checkbox');
    expect(casilla).toBeChecked();
    // Marca PROPIA: sigue siendo editable — quien la puso puede quitarla.
    expect(casilla).toBeEnabled();
    expect(screen.queryByTestId('requires-review-inherited')).not.toBeInTheDocument();
  });

  it('NO MIENTE: una hija de una categoría marcada muestra la HERENCIA, no su falso propio', async () => {
    // EL CASO QUE SOSTIENE TODO EL CONTROL. La hija tiene `requiresReview: false`
    // propio, pero su rama SÍ se revisa. Una casilla ingenua la pintaría
    // desmarcada y el admin creería que esa rama publica directa.
    mockGetAdminCategories.mockResolvedValue([
      rootCat({
        id: 'a', name: 'Vehículos', requiresReview: true,
        children: [rootCat({ id: 'b', name: 'Coches', requiresReview: false })],
      }),
    ]);
    await abrirEdicionDe('Coches', 1);

    const casilla = screen.getByTestId('requires-review-checkbox');
    expect(casilla).toBeChecked();
    // Y no se puede aflojar desde aquí, igual que en el backend (pliegue monótono).
    expect(casilla).toBeDisabled();
    expect(screen.getByTestId('requires-review-inherited')).toHaveTextContent('Vehículos');
  });

  it('la herencia alcanza al NIVEL 4, no sólo al hijo directo', async () => {
    // R1 de la profundidad, en la UI: el pliegue del cliente recorre la cadena
    // entera con `cadenaHasta`, no mira sólo al padre. Con un pliegue de un solo
    // nivel el bisnieto aparecería desmarcado, que es justo la mentira que M1
    // evitó en el motor.
    mockGetAdminCategories.mockResolvedValue([
      rootCat({
        id: 'a', name: 'Vehículos', requiresReview: true,
        children: [rootCat({
          id: 'b', name: 'Coches',
          children: [rootCat({
            id: 'c', name: 'Usados',
            children: [rootCat({ id: 'd', name: 'Diésel' })],
          })],
        })],
      }),
    ]);
    await abrirEdicionDe('Diésel', 3);

    expect(screen.getByTestId('requires-review-checkbox')).toBeChecked();
    // Se nombra el ORIGEN de la imposición (el ancestro más alto marcado), no el
    // padre inmediato, que no tiene marca propia.
    expect(screen.getByTestId('requires-review-inherited')).toHaveTextContent('Vehículos');
  });

  it('guardar una hija con la marca HEREDADA no le inventa una marca propia', async () => {
    // La casilla se ve marcada, pero lo que se persiste es lo PROPIO. Si el
    // formulario guardase lo que muestra, desmarcar el ancestro dejaría a la hija
    // marcada por su cuenta sin que nadie lo hubiera pedido.
    mockGetAdminCategories.mockResolvedValue([
      rootCat({
        id: 'a', name: 'Vehículos', requiresReview: true,
        children: [rootCat({ id: 'b', name: 'Coches' })],
      }),
    ]);
    await abrirEdicionDe('Coches', 1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => expect(mockUpdateAdminCategory).toHaveBeenCalled());
    const [, , dto] = mockUpdateAdminCategory.mock.calls[0];
    expect(dto.requiresReview).toBe(false);
  });

  it('ESCRIBE: marcar la casilla al editar manda requiresReview: true', async () => {
    mockGetAdminCategories.mockResolvedValue([rootCat({ id: 'a', name: 'A' })]);
    await abrirEdicionDe('A', 0);

    fireEvent.click(screen.getByTestId('requires-review-checkbox'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => expect(mockUpdateAdminCategory).toHaveBeenCalled());
    const [, id, dto] = mockUpdateAdminCategory.mock.calls[0];
    expect(id).toBe('a');
    expect(dto.requiresReview).toBe(true);
  });

  it('ESCRIBE al crear: una categoría raíz nueva puede nacer marcada', async () => {
    mockGetAdminCategories.mockResolvedValue([]);
    render(<AdminCategoriasPage />);
    await waitFor(() => screen.getByRole('button', { name: 'Nueva categoría raíz' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nueva categoría raíz' }));

    const [nombreInput, slugInput] = screen.getAllByRole('textbox');
    fireEvent.change(nombreInput, { target: { value: 'Nueva' } });
    fireEvent.change(slugInput, { target: { value: 'nueva' } });
    fireEvent.click(screen.getByTestId('requires-review-checkbox'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    });

    await waitFor(() => expect(mockCreateAdminCategory).toHaveBeenCalled());
    const [, dto] = mockCreateAdminCategory.mock.calls[0];
    expect(dto.requiresReview).toBe(true);
  });

  it('crear una subcategoría bajo una rama marcada avisa de la herencia antes de crearla', async () => {
    // Aquí la cadena va entera (el futuro padre incluido): lo que ya está marcado
    // en él es herencia para la que va a nacer.
    mockGetAdminCategories.mockResolvedValue([
      rootCat({ id: 'a', name: 'Vehículos', requiresReview: true }),
    ]);
    render(<AdminCategoriasPage />);

    await waitFor(() => screen.getByText('Vehículos'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Nueva subcategoría' }));
    });

    await waitFor(() => screen.getByTestId('requires-review-checkbox'));
    expect(screen.getByTestId('requires-review-checkbox')).toBeChecked();
    expect(screen.getByTestId('requires-review-checkbox')).toBeDisabled();
    expect(screen.getByTestId('requires-review-inherited')).toHaveTextContent('Vehículos');
  });

  it('una rama marcada NO alcanza a otra rama', async () => {
    // Control negativo: sin él, un pliegue que devolviera siempre `true` pasaría
    // todos los casos de arriba.
    mockGetAdminCategories.mockResolvedValue([
      rootCat({ id: 'a', name: 'Vehículos', order: 0, requiresReview: true }),
      rootCat({ id: 'z', name: 'Inmuebles', order: 1 }),
    ]);
    await abrirEdicionDe('Inmuebles', 1);

    expect(screen.getByTestId('requires-review-checkbox')).not.toBeChecked();
    expect(screen.getByTestId('requires-review-checkbox')).toBeEnabled();
    expect(screen.queryByTestId('requires-review-inherited')).not.toBeInTheDocument();
  });
});
