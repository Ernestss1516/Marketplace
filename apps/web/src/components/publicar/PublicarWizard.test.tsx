// RÁFAGA 3 (wizard producto/servicio) — política efectiva, filtrado por tipo
// en los 3 puntos de consumo, y las dos transiciones de estado.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PublicarWizard } from './PublicarWizard';
import { getCategoryBySlug } from '@/lib/api/categorias';
import { createListing, publishListing } from '@/lib/api/anuncios';
import type { Category, CategoryWithSchema } from '@/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  // useRequireAuth() también llama a usePathname() para construir loginUrl.
  usePathname: () => '/publicar',
}));

jest.mock('next-auth/react', () => ({
  signOut: jest.fn(),
  // useRequireAuth() (llamado incondicionalmente por PublicarWizard para el
  // callbackUrl de sesión expirada) llama a useSession() — sin este mock,
  // TypeError: useSession is not a function.
  useSession: () => ({ data: null }),
}));

jest.mock('@/lib/api/categorias', () => ({
  getCategoryBySlug: jest.fn(),
}));

jest.mock('@/lib/api/anuncios', () => ({
  createListing: jest.fn(),
  publishListing: jest.fn(),
}));

// Radix Select necesita estos polyfills en jsdom.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
});

const mockGetCategoryBySlug = getCategoryBySlug as jest.MockedFunction<typeof getCategoryBySlug>;
const mockCreateListing = createListing as jest.MockedFunction<typeof createListing>;
const mockPublishListing = publishListing as jest.MockedFunction<typeof publishListing>;

// ── Fixtures ────────────────────────────────────────────────────────────────
// Pasos del wizard: categoria → (auto) → fotos → datos → atributos → ubicacion → previsualizacion.

const COMMON = { name: 'brand', label: 'Marca', type: 'text' as const, filterable: false, required: false };
const PRODUCT_ONLY = {
  name: 'warranty', label: 'Garantía', type: 'text' as const, filterable: false, required: true,
  appliesTo: ['PRODUCT' as const],
};
const SERVICE_ONLY = {
  name: 'specialty', label: 'Especialidad', type: 'text' as const, filterable: false, required: true,
  appliesTo: ['SERVICE' as const],
};

const CAT_BOTH: Category = { id: 'cat-both', name: 'Categoría Ambos', slug: 'cat-both' };
const CAT_PRODUCT_ONLY: Category = { id: 'cat-po', name: 'Categoría Solo Producto', slug: 'cat-po' };

const SCHEMA_BOTH: CategoryWithSchema = {
  id: 'cat-both', name: 'Categoría Ambos', slug: 'cat-both',
  attributeSchema: [COMMON, PRODUCT_ONLY, SERVICE_ONLY],
  allowedListingType: 'BOTH',
  allowedViews: ['LISTA', 'AMPLIADA', 'MAPA'], defaultView: 'LISTA',
  // RP.3 — findBySlug siempre resuelve este campo (nunca ausente en respuestas
  // reales). [ONE_TIME] es el efectivo de una categoría sin configurar: con un
  // solo formato el selector no se renderiza, que es el caso de siempre.
  allowedPriceUnits: ['ONE_TIME'],
};
const SCHEMA_PRODUCT_ONLY: CategoryWithSchema = {
  id: 'cat-po', name: 'Categoría Solo Producto', slug: 'cat-po',
  attributeSchema: [COMMON, PRODUCT_ONLY],
  allowedListingType: 'PRODUCT_ONLY',
  allowedViews: ['LISTA', 'AMPLIADA', 'MAPA'], defaultView: 'LISTA',
  allowedPriceUnits: ['ONE_TIME'],
};

function renderWizard() {
  return render(
    <PublicarWizard
      token="test-token"
      categories={[CAT_BOTH, CAT_PRODUCT_ONLY]}
      initialLocation={{ city: 'Madrid', province: 'Madrid' }}
        photoLimits={{ max: 15, min: 1, minEnforced: false }}
        isPro={false}
    />,
  );
}

function goNext() {
  fireEvent.click(screen.getByRole('button', { name: /^(Siguiente|Revisar)$/ }));
}

function goBack() {
  fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
}

/** Elige una categoría (auto-avanza a "fotos") y salta ese paso hasta "Datos". */
async function pickCategoryAndReachDatos(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
  await waitFor(() => screen.getByRole('heading', { name: 'Fotos' }));
  goNext(); // fotos → datos (sin fotos: válido)
  await waitFor(() => screen.getByText('Datos del anuncio'));
}

/** Desde "datos", retrocede hasta la pantalla de elegir categoría (2 pasos atrás). */
async function backToCategoryPicker() {
  goBack(); // datos → fotos
  await waitFor(() => screen.getByRole('heading', { name: 'Fotos' }));
  goBack(); // fotos → categoria
  await waitFor(() => screen.getByText('Elige una categoría'));
}

function fillDatosBase() {
  fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'Anuncio de prueba' } });
  fireEvent.change(screen.getByLabelText(/Descripción/), { target: { value: 'Descripción de prueba con contenido' } });
  fireEvent.change(document.querySelector('#price') as HTMLElement, { target: { value: '50' } });
}

function selectCondition(label: string) {
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.click(screen.getByText(label));
}

describe('PublicarWizard — política efectiva y filtrado por tipo (RÁFAGA 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateListing.mockResolvedValue({ id: 'listing-1', slug: 'anuncio-de-prueba', status: 'DRAFT' });
    mockPublishListing.mockResolvedValue({ id: 'listing-1', slug: 'anuncio-de-prueba', status: 'ACTIVE', publishedAt: '2026-01-01' });
  });

  it('categoría BOTH → el RadioGroup de tipo es visible (se pregunta)', async () => {
    mockGetCategoryBySlug.mockResolvedValue(SCHEMA_BOTH);
    renderWizard();

    await pickCategoryAndReachDatos('Categoría Ambos');

    expect(screen.getByLabelText('Producto')).toBeInTheDocument();
    expect(screen.getByLabelText('Servicio')).toBeInTheDocument();
  });

  it('categoría PRODUCT_ONLY → el RadioGroup se oculta y el tipo queda fijado en PRODUCT', async () => {
    mockGetCategoryBySlug.mockResolvedValue(SCHEMA_PRODUCT_ONLY);
    renderWizard();

    await pickCategoryAndReachDatos('Categoría Solo Producto');

    expect(screen.queryByLabelText('Producto')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Servicio')).not.toBeInTheDocument();
    expect(screen.getByText('Producto')).toBeInTheDocument(); // texto fijo, no radio
    expect(screen.getByText('El tipo no se puede cambiar tras crear el anuncio.')).toBeInTheDocument();
  });

  it('en SERVICE: el atributo solo-PRODUCT requerido (warranty) no se muestra y no bloquea el avance', async () => {
    mockGetCategoryBySlug.mockResolvedValue(SCHEMA_BOTH);
    renderWizard();

    await pickCategoryAndReachDatos('Categoría Ambos');
    fillDatosBase();
    fireEvent.click(screen.getByLabelText('Servicio'));
    goNext(); // datos → atributos (SERVICE no exige condition)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Atributos' })).toBeInTheDocument());
    expect(screen.queryByLabelText(/Garantía/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Especialidad/)).toBeInTheDocument();

    // warranty (required) está oculto — no debe bloquear el avance aunque
    // specialty (required, SERVICE) sí se rellene.
    fireEvent.change(screen.getByLabelText(/Especialidad/), { target: { value: 'Fontanería' } });
    goNext();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ubicación' })).toBeInTheDocument());
  });

  it('CRÍTICO: PRODUCT→SERVICE — el body enviado incluye lo común + lo de SERVICE, excluye lo de PRODUCT', async () => {
    mockGetCategoryBySlug.mockResolvedValue(SCHEMA_BOTH);
    renderWizard();

    await pickCategoryAndReachDatos('Categoría Ambos');
    fillDatosBase();
    fireEvent.click(screen.getByLabelText('Producto'));
    selectCondition('Buen estado');
    goNext(); // datos → atributos, con PRODUCT

    await waitFor(() => screen.getByRole('heading', { name: 'Atributos' }));
    fireEvent.change(screen.getByLabelText(/Marca/), { target: { value: 'Bosch' } });
    fireEvent.change(screen.getByLabelText(/Garantía/), { target: { value: '2 años' } });

    // Vuelve a datos y cambia a SERVICE.
    goBack(); // atributos → datos
    await waitFor(() => screen.getByText('Datos del anuncio'));
    fireEvent.click(screen.getByLabelText('Servicio'));
    goNext(); // datos → atributos, ahora con SERVICE

    await waitFor(() => screen.getByRole('heading', { name: 'Atributos' }));
    expect(screen.queryByLabelText(/Garantía/)).not.toBeInTheDocument(); // oculto, pero sigue en memoria
    fireEvent.change(screen.getByLabelText(/Especialidad/), { target: { value: 'Electricidad' } });
    goNext(); // atributos → ubicación (ciudad/provincia precargadas)
    await waitFor(() => screen.getByRole('heading', { name: 'Ubicación' }));
    goNext(); // ubicación → previsualización

    await waitFor(() => screen.getByRole('button', { name: 'Guardar borrador' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));

    await waitFor(() => expect(mockCreateListing).toHaveBeenCalled());
    const [payload] = mockCreateListing.mock.calls[0];
    expect(payload.type).toBe('SERVICE');
    expect(payload.attributes).toEqual({ brand: 'Bosch', specialty: 'Electricidad' });
    expect(payload.attributes).not.toHaveProperty('warranty');
  });

  it('transición de CATEGORÍA: BOTH+SERVICE → cambia a PRODUCT_ONLY: el tipo pasa a PRODUCT y los atributos se limpian', async () => {
    mockGetCategoryBySlug
      .mockResolvedValueOnce(SCHEMA_BOTH)
      .mockResolvedValueOnce(SCHEMA_PRODUCT_ONLY);
    renderWizard();

    await pickCategoryAndReachDatos('Categoría Ambos');
    fireEvent.click(screen.getByLabelText('Servicio'));

    await backToCategoryPicker();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Categoría Solo Producto' }));
    });
    await waitFor(() => screen.getByRole('heading', { name: 'Fotos' }));
    goNext();
    await waitFor(() => screen.getByText('Datos del anuncio'));

    expect(screen.getByText('Producto')).toBeInTheDocument(); // fijado, sin preguntar
    expect(screen.queryByLabelText('Servicio')).not.toBeInTheDocument();

    fillDatosBase();
    selectCondition('Buen estado');
    goNext();
    await waitFor(() => screen.getByRole('heading', { name: 'Atributos' }));
    // El schema de la nueva categoría no incluye specialty; warranty quedó vacío (attributes se limpió).
    expect(screen.queryByLabelText(/Especialidad/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Garantía/)).toHaveValue('');
  });

  it('transición de TIPO (conservar): PRODUCT→SERVICE→PRODUCT — el valor de Garantía sigue ahí', async () => {
    mockGetCategoryBySlug.mockResolvedValue(SCHEMA_BOTH);
    renderWizard();

    await pickCategoryAndReachDatos('Categoría Ambos');
    fillDatosBase();
    fireEvent.click(screen.getByLabelText('Producto'));
    selectCondition('Buen estado');
    goNext();

    await waitFor(() => screen.getByRole('heading', { name: 'Atributos' }));
    fireEvent.change(screen.getByLabelText(/Garantía/), { target: { value: '3 años' } });

    goBack(); // atributos → datos
    await waitFor(() => screen.getByText('Datos del anuncio'));
    fireEvent.click(screen.getByLabelText('Servicio'));
    goNext();
    await waitFor(() => screen.getByRole('heading', { name: 'Atributos' }));
    expect(screen.queryByLabelText(/Garantía/)).not.toBeInTheDocument();

    goBack(); // atributos → datos
    await waitFor(() => screen.getByText('Datos del anuncio'));
    fireEvent.click(screen.getByLabelText('Producto'));
    // Cambiar a SERVICE limpió `condition` (comportamiento existente de StepDatos);
    // hay que volver a fijarlo para poder avanzar de nuevo con PRODUCT.
    selectCondition('Buen estado');
    goNext();

    await waitFor(() => screen.getByRole('heading', { name: 'Atributos' }));
    expect(screen.getByLabelText(/Garantía/)).toHaveValue('3 años');
  });
});

// ─── RP.3 — selector de formato de precio ───────────────────────────────────

/** Categoría con varios formatos: aquí SÍ hay elección, así que el selector se
 *  renderiza. Sin atributos, para que el wizard salte el paso "Atributos", y
 *  SERVICE_ONLY para que tampoco pregunte el estado (un solo combobox en
 *  pantalla: el de formato). */
const SCHEMA_MULTI: CategoryWithSchema = {
  id: 'cat-multi', name: 'Categoría Multi Formato', slug: 'cat-multi',
  attributeSchema: [],
  allowedListingType: 'SERVICE_ONLY',
  allowedViews: ['LISTA', 'AMPLIADA', 'MAPA'], defaultView: 'LISTA',
  allowedPriceUnits: ['ONE_TIME', 'PER_MONTH', 'PER_HOUR'],
};

const CAT_MULTI: Category = { id: 'cat-multi', name: 'Categoría Multi Formato', slug: 'cat-multi' };

function renderWizardWith(categories: Category[]) {
  return render(
    <PublicarWizard
      token="test-token"
      categories={categories}
      initialLocation={{ city: 'Madrid', province: 'Madrid' }}
        photoLimits={{ max: 15, min: 1, minEnforced: false }}
        isPro={false}
    />,
  );
}

/** Elige el formato en el Select de shadcn: abre el trigger por su testid y
 *  pulsa la opción por su etiqueta. No sirve getByRole('combobox') a secas —
 *  en una categoría de producto convive con el select de estado. */
function selectPriceUnit(label: string) {
  fireEvent.click(screen.getByTestId('price-unit-select'));
  fireEvent.click(screen.getByText(label));
}

/** Desde "datos": ubicación → previsualización → guardar borrador. Devuelve el
 *  payload con el que se llamó a createListing. */
async function submitAsDraft() {
  goNext(); // datos → ubicación (sin atributos, ese paso no existe)
  await waitFor(() => screen.getByRole('heading', { name: 'Ubicación' }));
  goNext(); // ubicación → previsualización
  await waitFor(() => screen.getByRole('button', { name: 'Guardar borrador' }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  await waitFor(() => expect(mockCreateListing).toHaveBeenCalled());
  return mockCreateListing.mock.calls[0][0];
}

describe('PublicarWizard — formato de precio (RP.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateListing.mockResolvedValue({ id: 'listing-1', slug: 'anuncio-de-prueba', status: 'DRAFT' });
    mockPublishListing.mockResolvedValue({ id: 'listing-1', slug: 'anuncio-de-prueba', status: 'ACTIVE', publishedAt: '2026-01-01' });
  });

  // ── Categoría sin configurar: el formulario de siempre ────────────────────

  it('categoría no configurada (efectivo [ONE_TIME]) → el selector NO se renderiza', async () => {
    mockGetCategoryBySlug.mockResolvedValue(SCHEMA_BOTH);
    renderWizard();

    await pickCategoryAndReachDatos('Categoría Ambos');

    expect(screen.queryByTestId('price-unit-select')).not.toBeInTheDocument();
  });

  it('categoría no configurada → el anuncio se crea con ONE_TIME', async () => {
    mockGetCategoryBySlug.mockResolvedValue(SCHEMA_PRODUCT_ONLY);
    renderWizardWith([CAT_PRODUCT_ONLY]);

    await pickCategoryAndReachDatos('Categoría Solo Producto');
    fillDatosBase();
    selectCondition('Buen estado');
    goNext(); // datos → atributos
    await waitFor(() => screen.getByRole('heading', { name: 'Atributos' }));
    fireEvent.change(screen.getByLabelText(/Marca/), { target: { value: 'Bosch' } });
    fireEvent.change(screen.getByLabelText(/Garantía/), { target: { value: '2 años' } });
    goNext();
    await waitFor(() => screen.getByRole('heading', { name: 'Ubicación' }));
    goNext();
    await waitFor(() => screen.getByRole('button', { name: 'Guardar borrador' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));

    await waitFor(() => expect(mockCreateListing).toHaveBeenCalled());
    expect(mockCreateListing.mock.calls[0][0].priceUnit).toBe('ONE_TIME');
  });

  // ── Categoría con varios formatos ─────────────────────────────────────────

  it('categoría multi-formato → el selector aparece, con SOLO los formatos permitidos', async () => {
    mockGetCategoryBySlug.mockResolvedValue(SCHEMA_MULTI);
    renderWizardWith([CAT_MULTI]);

    await pickCategoryAndReachDatos('Categoría Multi Formato');

    expect(screen.getByTestId('price-unit-select')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('price-unit-select'));

    expect(screen.getByText('Al mes')).toBeInTheDocument();
    expect(screen.getByText('Por hora')).toBeInTheDocument();
    // Formatos que la categoría NO permite: no se ofrecen.
    expect(screen.queryByText('A la semana')).not.toBeInTheDocument();
    expect(screen.queryByText('Por sesión')).not.toBeInTheDocument();
  });

  it('preselección: ONE_TIME cuando está entre los permitidos', async () => {
    mockGetCategoryBySlug.mockResolvedValue(SCHEMA_MULTI);
    renderWizardWith([CAT_MULTI]);

    await pickCategoryAndReachDatos('Categoría Multi Formato');

    expect(screen.getByTestId('price-unit-select')).toHaveTextContent('Pago único');
  });

  it('elegir "Por hora" → el anuncio se crea con PER_HOUR', async () => {
    mockGetCategoryBySlug.mockResolvedValue(SCHEMA_MULTI);
    renderWizardWith([CAT_MULTI]);

    await pickCategoryAndReachDatos('Categoría Multi Formato');
    fillDatosBase();
    selectPriceUnit('Por hora');

    const payload = await submitAsDraft();
    expect(payload.priceUnit).toBe('PER_HOUR');
    expect(payload.priceType).toBe('FIXED');
  });

  // ── Interacción con el modo de precio ─────────────────────────────────────

  it('priceMode "Gratis" → el selector NO se renderiza', async () => {
    mockGetCategoryBySlug.mockResolvedValue(SCHEMA_MULTI);
    renderWizardWith([CAT_MULTI]);

    await pickCategoryAndReachDatos('Categoría Multi Formato');
    expect(screen.getByTestId('price-unit-select')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Gratis'));
    expect(screen.queryByTestId('price-unit-select')).not.toBeInTheDocument();
  });

  it('"Gratis" se envía siempre con ONE_TIME, aunque antes se hubiera elegido otro formato', async () => {
    mockGetCategoryBySlug.mockResolvedValue(SCHEMA_MULTI);
    renderWizardWith([CAT_MULTI]);

    await pickCategoryAndReachDatos('Categoría Multi Formato');
    fillDatosBase();
    selectPriceUnit('Por hora');
    fireEvent.click(screen.getByLabelText('Gratis'));

    const payload = await submitAsDraft();
    expect(payload.priceType).toBe('FREE');
    expect(payload.priceUnit).toBe('ONE_TIME');
  });

  it('NEGOTIABLE + formato: "A convenir" mantiene el selector y respeta la elección', async () => {
    mockGetCategoryBySlug.mockResolvedValue(SCHEMA_MULTI);
    renderWizardWith([CAT_MULTI]);

    await pickCategoryAndReachDatos('Categoría Multi Formato');
    fireEvent.change(screen.getByLabelText(/Título/), { target: { value: 'Alquiler de prueba' } });
    fireEvent.change(screen.getByLabelText(/Descripción/), { target: { value: 'Descripción de prueba con contenido' } });
    fireEvent.click(screen.getByLabelText('A convenir'));

    // El selector sigue presente con "A convenir" (decisión aprobada, §7.1).
    expect(screen.getByTestId('price-unit-select')).toBeInTheDocument();
    selectPriceUnit('Al mes');

    const payload = await submitAsDraft();
    expect(payload.priceType).toBe('NEGOTIABLE');
    expect(payload.priceUnit).toBe('PER_MONTH');
  });
});
