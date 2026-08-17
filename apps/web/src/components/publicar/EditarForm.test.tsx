// RP.3 — formato de precio en la edición: preselección del formato ACTUAL del
// anuncio y envío de priceUnit SOLO cuando el vendedor lo cambia (para no
// revalidar contra la categoría una edición que no lo tocaba — el mismo
// grandfathering que garantiza update() en el backend).
//
// UXV.5 — las mismas afirmaciones, sobre el editor de SECCIONES. Lo que cambia es que ya
// no hay que recorrer el wizard para llegar a los sitios: `reachDatos` y el paseo hasta
// Ubicación desaparecen porque todo está en pantalla desde el principio, que es
// exactamente el arreglo de A4. Ninguna aserción se ha relajado.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditarForm, resolveEditSections, type EditarFormData } from './EditarForm';
import { updateListing } from '@/lib/api/anuncios';
import type { ProStatus } from '@/lib/api/billing';
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

function buildInitialData(overrides: Partial<EditarFormData> = {}): EditarFormData {
  return {
    categoryId: 'cat-1',
    categorySlug: 'cat-1',
    categoryName: 'Categoría',
    attributeSchema: [],
    allowedPriceUnits: ['ONE_TIME', 'PER_MONTH', 'PER_HOUR'],
    // B2 — sin tags efectivos: este spec va del formato de precio, y la regla de
    // desaparición hace que la sección de etiquetas ni exista, igual que ya pasaba con
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

function renderEditar(overrides: Partial<EditarFormData> = {}) {
  return render(
    <EditarForm
      listingId="listing-1"
      token="test-token"
      initialData={buildInitialData(overrides)}
      photoLimits={{ max: 15, min: 1, minEnforced: false }}
    />,
  );
}

/** Guarda. Devuelve el payload del PATCH. */
async function save() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('guardar-cambios'));
  });
  await waitFor(() => expect(mockUpdateListing).toHaveBeenCalled());
  return mockUpdateListing.mock.calls[0][1];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateListing.mockResolvedValue({ id: 'listing-1', slug: 'anuncio-existente' } as never);
});

describe('EditarForm — formato de precio (RP.3)', () => {
  it('preselecciona el formato ACTUAL del anuncio, no ONE_TIME', () => {
    renderEditar();
    expect(screen.getByTestId('price-unit-select')).toHaveTextContent('Por hora');
  });

  it('categoría con un solo formato → el selector no se renderiza (edición sin fricción)', () => {
    renderEditar({ allowedPriceUnits: ['ONE_TIME'], priceUnit: 'ONE_TIME' });
    expect(screen.queryByTestId('price-unit-select')).not.toBeInTheDocument();
  });

  it('si no se toca el formato, el PATCH NO envía priceUnit (no lo revalida)', async () => {
    renderEditar();
    const payload = await save();
    expect(payload).not.toHaveProperty('priceUnit');
  });

  it('cambiar el formato sí lo envía en el PATCH', async () => {
    renderEditar();

    fireEvent.click(screen.getByTestId('price-unit-select'));
    fireEvent.click(screen.getByText('Al mes'));

    const payload = await save();
    expect(payload.priceUnit).toBe('PER_MONTH');
  });

  it('un formato que la categoría ya no permite se normaliza al abrir la edición', () => {
    // Caso de borde: el guard de RP.2 lo impide por la vía del admin, pero si ocurriera,
    // el selector no debe quedarse en blanco.
    renderEditar({ allowedPriceUnits: ['ONE_TIME', 'PER_MONTH'], priceUnit: 'PER_MONTH' });
    expect(screen.getByTestId('price-unit-select')).toHaveTextContent('Al mes');
  });

  it('pasar a "Gratis" envía ONE_TIME', async () => {
    renderEditar();
    fireEvent.click(screen.getByLabelText('Gratis'));

    const payload = await save();
    expect(payload.priceType).toBe('FREE');
    expect(payload.priceUnit as PriceUnit).toBe('ONE_TIME');
  });
});

describe('UXV.5 (A4) — cambiar un campo ya no cuesta cinco pantallas', () => {
  it('todas las secciones están en pantalla desde el principio', () => {
    renderEditar();

    // Antes: solo «Fotos» era visible y las demás exigían pulsar «Siguiente».
    expect(screen.getByTestId('seccion-fotos')).toBeInTheDocument();
    expect(screen.getByTestId('seccion-datos')).toBeInTheDocument();
    expect(screen.getByTestId('seccion-ubicacion')).toBeInTheDocument();
  });

  it('«Guardar cambios» está disponible sin recorrer nada', async () => {
    renderEditar();

    // Antes este botón solo existía en el último paso del wizard.
    expect(screen.getByTestId('guardar-cambios')).toBeInTheDocument();

    const payload = await save();
    // Y guarda el anuncio COMPLETO, no solo lo que se tocó.
    expect(payload.title).toBe('Anuncio existente');
    expect(payload.city).toBe('Madrid');
    expect(payload.tags).toEqual([]);
  });

  it('editar el precio y guardar, sin pasar por ninguna otra sección', async () => {
    renderEditar();

    fireEvent.change(document.getElementById('price')!, { target: { value: '99' } });
    const payload = await save();

    expect(payload.price).toBe(99);
  });

  it('hay «Cancelar», y avisa de que quedan cambios sin guardar', () => {
    renderEditar();

    expect(screen.getByTestId('cancelar-edicion')).toBeInTheDocument();
    // Sin tocar nada no hay nada que avisar.
    expect(screen.queryByTestId('aviso-sin-guardar')).not.toBeInTheDocument();

    fireEvent.change(document.getElementById('title')!, { target: { value: 'Otro título' } });
    expect(screen.getByTestId('aviso-sin-guardar')).toBeInTheDocument();
  });

  it('la validación de CADA sección se preserva y bloquea el guardado', async () => {
    renderEditar();

    // Regla que vivía en el paso «Datos» del wizard.
    fireEvent.change(document.getElementById('title')!, { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('guardar-cambios'));
    });

    expect(mockUpdateListing).not.toHaveBeenCalled();
    expect(screen.getByText('El título es obligatorio.')).toBeInTheDocument();
  });

  it('una sección de OTRA parte del formulario también bloquea (se validan todas)', async () => {
    renderEditar();

    // Regla del paso «Ubicación», que en el wizard solo se comprobaba al llegar a él.
    fireEvent.change(document.getElementById('city')!, { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('guardar-cambios'));
    });

    expect(mockUpdateListing).not.toHaveBeenCalled();
    expect(screen.getByText('La ciudad es obligatoria.')).toBeInTheDocument();
  });
});

describe('UXV.5 — el seam del VÍDEO PRO', () => {
  const PRO: ProStatus = {
    isPro: true,
    limit: 4,
    used: 0,
    remaining: 4,
    bumpQuota: { limit: 5, used: 0, remaining: 5 },
  };

  const base = { attributeSchema: [], availableTags: [] };

  it('resolveEditSections acepta proStatus — es por donde entrará la sección de vídeo', () => {
    // HOY no cambia nada, y es correcto: el vídeo no está implementado. Lo que esta prueba
    // fija es que el cableado EXISTE, para que el proyecto 3 no tenga que abrirlo.
    expect(resolveEditSections(base, PRO).map((s) => s.id)).toEqual(['fotos', 'datos', 'ubicacion']);
    expect(resolveEditSections(base, null).map((s) => s.id)).toEqual(['fotos', 'datos', 'ubicacion']);
  });

  it('las reglas de desaparición de secciones siguen vigentes', () => {
    const conAtributos = {
      attributeSchema: [
        { name: 'x', label: 'X', type: 'text' as const, filterable: false, required: false },
      ],
      availableTags: [],
    };
    expect(resolveEditSections(conAtributos, null).map((s) => s.id)).toContain('atributos');
    expect(resolveEditSections(base, null).map((s) => s.id)).not.toContain('atributos');

    const conTags = {
      attributeSchema: [],
      availableTags: [{ id: 't1', slug: 'envio', name: 'Envío' }],
    };
    expect(resolveEditSections(conTags, null).map((s) => s.id)).toContain('tags');
    expect(resolveEditSections(base, null).map((s) => s.id)).not.toContain('tags');
  });
});
