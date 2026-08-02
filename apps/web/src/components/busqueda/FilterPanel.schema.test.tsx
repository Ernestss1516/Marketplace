// A3 — el panel de filtros pasa de FACET-DRIVEN a SCHEMA-DRIVEN.
//
// Cada test de aquí ejerce uno de los seis síntomas del diagnóstico. El de F6 es el
// hueco conceptual del ajuste: un atributo filtrable SIN ningún anuncio no aparecía
// nunca, porque la lista de secciones la dictaba el resultado y no la configuración.
//
// F3 (rango numérico) NO está: exige que el backend acepte `_min`/`_max` y eso es A4.
// Aquí un `number` se sigue pintando como chips — pero ya con su label y su unidad.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { FilterPanel } from './FilterPanel';
import type { AttributeFieldView } from '@/lib/filterable-fields';

const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/vehiculos/coches',
  useSearchParams: () => mockSearchParams,
}));

const BASE = {
  categories: [],
  currentFilters: {},
  activeFilterCount: 0,
};

beforeEach(() => {
  mockPush.mockClear();
  mockSearchParams = new URLSearchParams();
});

const seccion = (name: string) => screen.getByTestId(`facet-${name}`);

describe('F1 — la sección muestra el LABEL, no el nombre crudo del campo', () => {
  const campos: AttributeFieldView[] = [{ name: 'sqm', label: 'Metros cuadrados', type: 'number' }];

  it('pinta "Metros cuadrados", no "sqm"', () => {
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{ sqm: { '90': 2 } }} />);
    expect(within(seccion('sqm')).getByText(/Metros cuadrados/)).toBeInTheDocument();
    expect(screen.queryByText('sqm')).not.toBeInTheDocument();
  });
});

describe('F2 — la unidad se muestra', () => {
  it('un atributo con unit la lleva en el título de la sección', () => {
    const campos: AttributeFieldView[] = [
      { name: 'sqm', label: 'Metros cuadrados', type: 'number', unit: 'm²' },
    ];
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{ sqm: { '90': 2 } }} />);
    expect(within(seccion('sqm')).getByText(/m²/)).toBeInTheDocument();
  });

  it('sin unit no inventa nada', () => {
    const campos: AttributeFieldView[] = [{ name: 'rooms', label: 'Habitaciones', type: 'number' }];
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{ rooms: { '3': 1 } }} />);
    expect(within(seccion('rooms')).getByText('Habitaciones')).toBeInTheDocument();
  });
});

describe('F4 — booleanos como Sí/No, no true/false', () => {
  const campos: AttributeFieldView[] = [{ name: 'garaje', label: 'Garaje', type: 'boolean' }];

  it('ofrece "Sí" y "No"', () => {
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{ garaje: { true: 4, false: 2 } }} />);
    const s = within(seccion('garaje'));
    expect(s.getByRole('button', { name: /Sí/ })).toBeInTheDocument();
    expect(s.getByRole('button', { name: /No/ })).toBeInTheDocument();
    expect(s.queryByRole('button', { name: /true/ })).not.toBeInTheDocument();
  });

  it('al pulsar "Sí" filtra por el valor real (`true`), no por la etiqueta', () => {
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{ garaje: { true: 4, false: 2 } }} />);
    fireEvent.click(within(seccion('garaje')).getByRole('button', { name: /Sí/ }));
    expect(mockPush).toHaveBeenCalledWith('/vehiculos/coches?garaje=true');
  });

  it('la sección aparece aunque no haya NINGÚN anuncio (viene del schema)', () => {
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{}} />);
    const s = within(seccion('garaje'));
    expect(s.getByRole('button', { name: /Sí/ })).toBeDisabled();
    expect(s.getByRole('button', { name: /No/ })).toBeDisabled();
  });
});

describe('F5 — selects vinculados acotados por el padre', () => {
  const campos: AttributeFieldView[] = [
    { name: 'brand', label: 'Marca', type: 'select', options: ['Seat', 'Renault'] },
    {
      name: 'model', label: 'Modelo', type: 'select', dependsOn: 'brand',
      optionsByParent: { Seat: ['Ibiza', 'León'], Renault: ['Clio'] },
    },
  ];

  it('SIN marca elegida, el modelo no se ofrece', () => {
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{}} />);
    expect(screen.getByTestId('facet-brand')).toBeInTheDocument();
    expect(screen.queryByTestId('facet-model')).not.toBeInTheDocument();
  });

  it('CON marca elegida, solo aparecen los modelos de esa marca', () => {
    mockSearchParams = new URLSearchParams('brand=Seat');
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{}} />);

    const s = within(seccion('model'));
    expect(s.getByRole('button', { name: /Ibiza/ })).toBeInTheDocument();
    expect(s.getByRole('button', { name: /León/ })).toBeInTheDocument();
    expect(s.queryByRole('button', { name: /Clio/ })).not.toBeInTheDocument();
  });

  it('al cambiar de marca cambian los modelos ofrecidos', () => {
    mockSearchParams = new URLSearchParams('brand=Renault');
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{}} />);

    const s = within(seccion('model'));
    expect(s.getByRole('button', { name: /Clio/ })).toBeInTheDocument();
    expect(s.queryByRole('button', { name: /Ibiza/ })).not.toBeInTheDocument();
  });
});

describe('F6 — TODOS los filtrables se pintan, aunque no tengan anuncios', () => {
  it('EL HUECO DEL AJUSTE 3: una sección sin ninguna faceta APARECE igual', () => {
    // Antes de A3 esta sección no existía: la lista la dictaban las facetas, y sin
    // anuncios que tuvieran el atributo, Meilisearch no devolvía la clave.
    const campos: AttributeFieldView[] = [
      { name: 'gearbox', label: 'Cambio', type: 'select', options: ['Manual', 'Automático'] },
    ];
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{}} />);

    const s = within(seccion('gearbox'));
    expect(s.getByText('Cambio')).toBeInTheDocument();
    expect(s.getByRole('button', { name: /Manual/ })).toBeInTheDocument();
    expect(s.getByRole('button', { name: /Automático/ })).toBeInTheDocument();
  });

  it('los valores sin resultados se ven DESHABILITADOS con (0), no desaparecen', () => {
    const campos: AttributeFieldView[] = [
      { name: 'gearbox', label: 'Cambio', type: 'select', options: ['Manual', 'Automático'] },
    ];
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{ gearbox: { Manual: 3 } }} />);

    const s = within(seccion('gearbox'));
    expect(s.getByRole('button', { name: /Manual/ })).toBeEnabled();
    const automatico = s.getByRole('button', { name: /Automático/ });
    expect(automatico).toBeDisabled();
    expect(automatico).toHaveTextContent('(0)');
  });

  it('un valor muerto no navega si se intenta pulsar', () => {
    const campos: AttributeFieldView[] = [
      { name: 'gearbox', label: 'Cambio', type: 'select', options: ['Manual', 'Automático'] },
    ];
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{ gearbox: { Manual: 3 } }} />);

    fireEvent.click(within(seccion('gearbox')).getByRole('button', { name: /Automático/ }));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('un valor ACTIVO sigue pulsable aunque su conteo sea 0 (si no, no se podría quitar)', () => {
    mockSearchParams = new URLSearchParams('gearbox=Automático');
    const campos: AttributeFieldView[] = [
      { name: 'gearbox', label: 'Cambio', type: 'select', options: ['Manual', 'Automático'] },
    ];
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{ gearbox: {} }} />);

    const activo = within(seccion('gearbox')).getByRole('button', { name: /Automático/ });
    expect(activo).toBeEnabled();
    fireEvent.click(activo);
    expect(mockPush).toHaveBeenCalledWith('/vehiculos/coches?');
  });
});

describe('number y text — se pintan, con su label; el rango es A4', () => {
  it('un `number` sigue como chips de los valores que haya (su rango es A4)', () => {
    const campos: AttributeFieldView[] = [{ name: 'km', label: 'Kilómetros', type: 'number', unit: 'km' }];
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{ km: { '1000': 2, '5000': 1 } }} />);

    const s = within(seccion('km'));
    expect(s.getByText(/Kilómetros/)).toBeInTheDocument();
    expect(s.getByRole('button', { name: /1000/ })).toBeInTheDocument();
  });

  it('un `number` sin valores muestra la sección igualmente', () => {
    const campos: AttributeFieldView[] = [{ name: 'km', label: 'Kilómetros', type: 'number' }];
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{}} />);
    expect(within(seccion('km')).getByText('Sin valores todavía')).toBeInTheDocument();
  });

  it('un `text` se ofrece como input y aplica al pulsar Enter', () => {
    const campos: AttributeFieldView[] = [{ name: 'ref', label: 'Referencia', type: 'text' }];
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{}} />);

    const input = within(seccion('ref')).getByLabelText('Referencia');
    fireEvent.change(input, { target: { value: 'ABC' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledWith('/vehiculos/coches?ref=ABC');
  });
});

describe('las facetas NATIVAS siguen funcionando como antes', () => {
  it('priceUnit se sigue pintando desde las facetas (no es un atributo de categoría)', () => {
    render(
      <FilterPanel
        {...BASE}
        filterableFields={[]}
        facets={{ priceUnit: { ONE_TIME: 3, PER_MONTH: 2 } }}
      />,
    );
    expect(within(seccion('priceUnit')).getByText('Formato del precio')).toBeInTheDocument();
  });

  it('un atributo de categoría NO se duplica: si está en filterableFields, no lo repite el bloque nativo', () => {
    const campos: AttributeFieldView[] = [
      { name: 'fuel', label: 'Combustible', type: 'select', options: ['Diésel'] },
    ];
    render(<FilterPanel {...BASE} filterableFields={campos} facets={{ fuel: { 'Diésel': 2 } }} />);
    expect(screen.getAllByTestId('facet-fuel')).toHaveLength(1);
  });

  it('sin filterableFields el panel se comporta como antes (solo facetas)', () => {
    render(<FilterPanel {...BASE} facets={{ fuel: { 'Diésel': 2 } }} />);
    expect(seccion('fuel')).toBeInTheDocument();
  });
});
