// RP.3 — formato de precio en la edición: preselección del formato ACTUAL del
// anuncio y envío de priceUnit SOLO cuando el vendedor lo cambia (para no
// revalidar contra la categoría una edición que no lo tocaba — el mismo
// grandfathering que garantiza update() en el backend).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditarWizard, type EditarWizardData } from './EditarWizard';
import { updateListing } from '@/lib/api/anuncios';
import type { PriceUnit } from '@/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/mis-anuncios',
}));

jest.mock('next-auth/react', () => ({
  signOut: jest.fn(),
  useSession: () => ({ data: null }),
}));

jest.mock('@/lib/api/anuncios', () => ({
  updateListing: jest.fn(),
}));

const mockUpdateListing = updateListing as jest.MockedFunction<typeof updateListing>;

function buildInitialData(overrides: Partial<EditarWizardData> = {}): EditarWizardData {
  return {
    categoryId: 'cat-1',
    categorySlug: 'cat-1',
    categoryName: 'Categoría',
    attributeSchema: [],
    allowedPriceUnits: ['ONE_TIME', 'PER_MONTH', 'PER_HOUR'],
    // B2 — sin tags efectivos: este spec va del formato de precio, y la regla de
    // desaparición hace que el paso de etiquetas ni exista, igual que ya pasaba con
    // 'atributos' por el attributeSchema vacío de arriba.
    availableTags: [],
    maxTags: 5,
    images: [],
    attributes: {},
    tags: [],
    title: 'Anuncio existente',
    description: 'Descripción del anuncio existente',
    type: 'SERVICE',
    condition: '',
    priceMode: 'fixed',
    price: '50',
    priceUnit: 'PER_HOUR',
    city: 'Madrid',
    province: 'Madrid',
    postalCode: '',
    phone: '',
    ...overrides,
  };
}

function renderEditar(overrides: Partial<EditarWizardData> = {}) {
  return render(
    <EditarWizard listingId="listing-1" token="test-token" initialData={buildInitialData(overrides)} />,
  );
}

/** El wizard de edición abre en "Fotos"; un paso adelante llega a "Datos". */
async function reachDatos() {
  fireEvent.click(screen.getByRole('button', { name: /^(Siguiente|Revisar)$/ }));
  await waitFor(() => screen.getByText('Datos del anuncio'));
}

/** Recorre datos → ubicación → guardar. Devuelve el payload del PATCH. */
async function save() {
  fireEvent.click(screen.getByRole('button', { name: /^(Siguiente|Revisar)$/ }));
  await waitFor(() => screen.getByRole('heading', { name: 'Ubicación' }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
  });
  await waitFor(() => expect(mockUpdateListing).toHaveBeenCalled());
  return mockUpdateListing.mock.calls[0][1];
}

describe('EditarWizard — formato de precio (RP.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateListing.mockResolvedValue({ id: 'listing-1', slug: 'anuncio-existente' } as never);
  });

  it('preselecciona el formato ACTUAL del anuncio, no ONE_TIME', async () => {
    renderEditar();
    await reachDatos();

    expect(screen.getByTestId('price-unit-select')).toHaveTextContent('Por hora');
  });

  it('categoría con un solo formato → el selector no se renderiza (edición sin fricción)', async () => {
    renderEditar({ allowedPriceUnits: ['ONE_TIME'], priceUnit: 'ONE_TIME' });
    await reachDatos();

    expect(screen.queryByTestId('price-unit-select')).not.toBeInTheDocument();
  });

  it('si no se toca el formato, el PATCH NO envía priceUnit (no lo revalida)', async () => {
    renderEditar();
    await reachDatos();

    const payload = await save();
    expect(payload).not.toHaveProperty('priceUnit');
  });

  it('cambiar el formato sí lo envía en el PATCH', async () => {
    renderEditar();
    await reachDatos();

    fireEvent.click(screen.getByTestId('price-unit-select'));
    fireEvent.click(screen.getByText('Al mes'));

    const payload = await save();
    expect(payload.priceUnit).toBe('PER_MONTH');
  });

  it('un formato que la categoría ya no permite se normaliza al abrir la edición', async () => {
    // Caso de borde: el guard de RP.2 lo impide por la vía del admin, pero si
    // ocurriera, el selector no debe quedarse en blanco.
    renderEditar({ allowedPriceUnits: ['ONE_TIME', 'PER_MONTH'], priceUnit: 'PER_MONTH' });
    await reachDatos();

    expect(screen.getByTestId('price-unit-select')).toHaveTextContent('Al mes');
  });

  it('pasar a "Gratis" envía ONE_TIME', async () => {
    renderEditar();
    await reachDatos();

    fireEvent.click(screen.getByLabelText('Gratis'));

    const payload = await save();
    expect(payload.priceType).toBe('FREE');
    expect(payload.priceUnit as PriceUnit).toBe('ONE_TIME');
  });
});
