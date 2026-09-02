// I18N T1 — LOS FILTROS PÚBLICOS, EN ESPAÑOL. LA BARRERA.
//
// El panel de filtros era el ÚNICO sitio de la plataforma donde un enum crudo daba la
// cara fuera del backoffice: una sección titulada «priceType» con chips «FIXED (12)»,
// «NEGOTIABLE (3)», «FREE (1)». Ver `docs/auditoria-i18n-espanol.md` §4.1 (D1 y D2).
//
// Y el defecto NO era que faltara la traducción: `TIPO_PRECIO_LABELS` existe desde la
// ráfaga de traducciones del backoffice, completo y con su propio test. Faltaba la
// LLAMADA. Por eso estos tests no comprueban textos a mano —comprobarlos aquí sería
// abrir la copia nº 32, que es justo el defecto de fondo—: comprueban que lo pintado
// **coincide con el diccionario compartido**, sea cual sea su texto. Si alguien cambia
// «A convenir» en `etiquetas.ts`, esto sigue verde; si alguien deja de llamarlo, no.
//
// Las cuatro mutaciones que este cuerpo tiene que matar:
//   B1 — volver a un saco común sin `PriceType` → los chips salen crudos otra vez;
//   B2 — quitar `priceType` de FACET_SECTION_LABELS → el título sale crudo otra vez;
//   B3 — traducir `province` en vez de eliminarla → vuelven los DOS filtros de provincia;
//   B4 — escribir las etiquetas a mano aquí dentro → la dispersión que T3 va a cerrar.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { FilterPanel } from './FilterPanel';
import { TIPO_PRECIO_LABELS, UNIDAD_PRECIO_LABELS } from '@/lib/etiquetas-enums';

const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/busqueda',
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

/** El reparto que devuelve Meilisearch, tal y como llega hoy: las siete facetas
 *  nativas de `search.service.ts`. Se pasan TODAS a propósito — lo que se afirma
 *  abajo es qué hace el panel con cada una. */
const FACETAS_REALES = {
  categorySlug: { coches: 12 },
  type: { PRODUCT: 12 },
  condition: { NEW: 4, GOOD: 8 },
  priceType: { FIXED: 12, NEGOTIABLE: 3, FREE: 1 },
  priceUnit: { ONE_TIME: 10, PER_MONTH: 6 },
  province: { Madrid: 9, Toledo: 4 },
  tags: { urgente: 2 },
};

// ─────────────────────────────────────────────────────────────────────────────
// B1 — LOS CHIPS DE `priceType` (D2)
// ─────────────────────────────────────────────────────────────────────────────

describe('B1 — los valores de «tipo de precio» se pintan traducidos', () => {
  it('cada chip lleva la etiqueta del diccionario compartido, no el valor del enum', () => {
    render(<FilterPanel {...BASE} facets={FACETAS_REALES} />);
    const bloque = seccion('priceType');

    // Los TRES valores de `PriceType`, cada uno con la etiqueta que dice
    // `etiquetas.ts` — leída de allí, no escrita aquí (B4).
    for (const valor of ['FIXED', 'NEGOTIABLE', 'FREE'] as const) {
      expect(within(bloque).getByText(new RegExp(TIPO_PRECIO_LABELS[valor]))).toBeInTheDocument();
    }
  });

  it('NINGÚN valor del enum se ve en crudo', () => {
    render(<FilterPanel {...BASE} facets={FACETAS_REALES} />);
    // Es el síntoma exacto que vio el usuario: «FIXED (12)» en un chip.
    for (const valor of ['FIXED', 'NEGOTIABLE', 'FREE']) {
      expect(screen.queryByText(new RegExp(`\\b${valor}\\b`))).not.toBeInTheDocument();
    }
  });

  it('el conteo sigue pegado a la etiqueta (traducir no se llevó el número)', () => {
    render(<FilterPanel {...BASE} facets={FACETAS_REALES} />);
    expect(within(seccion('priceType')).getByText('(12)')).toBeInTheDocument();
  });

  it('REGRESIÓN — `priceUnit` sigue traducido después de dejar el saco común', () => {
    // Antes ambas facetas compartían un único `Record` mal llamado `CONDITION_LABELS`.
    // Al partirlo por faceta, ésta es la que podía quedarse sin vocabulario.
    render(<FilterPanel {...BASE} facets={FACETAS_REALES} />);
    const bloque = seccion('priceUnit');
    expect(
      within(bloque).getByText(new RegExp(UNIDAD_PRECIO_LABELS.ONE_TIME)),
    ).toBeInTheDocument();
    expect(
      within(bloque).getByText(new RegExp(UNIDAD_PRECIO_LABELS.PER_MONTH)),
    ).toBeInTheDocument();
  });

  it('una faceta SIN vocabulario cae al valor crudo, no a una casilla vacía', () => {
    // La regla de `etiquetas.ts`: un valor sin etiqueta tiene que verse FEO, no
    // desaparecer. Un `?? ''` haría que una faceta nueva borrara sus propios chips.
    render(<FilterPanel {...BASE} facets={{ colorDeMoqueta: { GRANATE: 3 } }} />);
    expect(within(seccion('colorDeMoqueta')).getByText(/GRANATE/)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2 — EL TÍTULO DE LA SECCIÓN (D1)
// ─────────────────────────────────────────────────────────────────────────────

describe('B2 — la sección se titula en español, no con el nombre del campo', () => {
  it('dice «Tipo de precio» y no «priceType»', () => {
    render(<FilterPanel {...BASE} facets={FACETAS_REALES} />);
    expect(within(seccion('priceType')).getByText('Tipo de precio')).toBeInTheDocument();
    expect(screen.queryByText('priceType')).not.toBeInTheDocument();
  });

  it('REGRESIÓN — «Formato del precio» (`priceUnit`) sigue en su sitio', () => {
    render(<FilterPanel {...BASE} facets={FACETAS_REALES} />);
    expect(within(seccion('priceUnit')).getByText('Formato del precio')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B3 — `province`: ELIMINADA, NO TRADUCIDA
// ─────────────────────────────────────────────────────────────────────────────

describe('B3 — hay UN solo filtro de provincia, y es el selector «Ubicación»', () => {
  it('el bloque genérico ya no pinta una sección `province`', () => {
    render(<FilterPanel {...BASE} facets={FACETAS_REALES} />);
    expect(screen.queryByTestId('facet-province')).not.toBeInTheDocument();
    // Y tampoco pinta su título crudo — la mutación «traducirla en vez de quitarla»
    // dejaría la sección viva con otro nombre, así que mirar sólo el texto no basta.
    expect(screen.queryByText('province')).not.toBeInTheDocument();
  });

  it('el selector «Ubicación» sigue intacto, con sus provincias', () => {
    render(<FilterPanel {...BASE} facets={FACETAS_REALES} />);
    expect(screen.getByText('Ubicación')).toBeInTheDocument();
    const selector = screen.getByLabelText('Provincia');
    expect(selector).toBeInTheDocument();
    // Los VALORES nunca fueron el defecto: son nombres de provincia reales y salen
    // de `lib/provincias.ts`, no de las facetas del resultado.
    expect(within(selector).getByRole('option', { name: 'Madrid' })).toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: 'Toledo' })).toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: 'Toda España' })).toBeInTheDocument();
  });

  it('el selector sigue marcando la provincia activa', () => {
    render(<FilterPanel {...BASE} currentFilters={{ province: 'Madrid' }} facets={FACETAS_REALES} />);
    expect(screen.getByLabelText('Provincia')).toHaveValue('Madrid');
  });

  it('«Madrid» aparece UNA vez, no dos (era el síntoma de la duplicación)', () => {
    render(<FilterPanel {...BASE} facets={FACETAS_REALES} />);
    expect(screen.getAllByText('Madrid')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B4 — SIN COPIA NUEVA
// ─────────────────────────────────────────────────────────────────────────────
//
// Molde: `app/(admin)/admin/etiquetas.test.ts`, que ya lee el fuente de las fichas
// para comprobar que llaman al vocabulario en vez de escribirlo. Es la única forma de
// matar la mutación «lo arreglo copiando las tres líneas aquí»: el render sale idéntico
// y ningún test de pantalla lo notaría.

describe('B4 — el panel NO declara su propio vocabulario de enums', () => {
  const fuente = readFileSync(join(__dirname, 'FilterPanel.tsx'), 'utf8');

  it('importa las etiquetas de `PriceType` de su única fuente', () => {
    // T3-B — la ruta cambió y con ella se saldó la deuda que T1 dejó anotada: este
    // componente PÚBLICO importaba de una carpeta de administración porque era el
    // único sitio donde vivía el vocabulario. Ya vive en `lib/`, que es su capa.
    expect(fuente).toMatch(/import \{[^}]*TIPO_PRECIO_LABELS[^}]*\} from '@\/lib\/etiquetas-enums'/);
    expect(fuente).not.toContain('@/app/(admin)/admin/etiquetas');
  });

  it('no escribe a mano ninguna etiqueta de `PriceType`', () => {
    for (const texto of Object.values(TIPO_PRECIO_LABELS)) {
      expect(fuente).not.toContain(`'${texto}'`);
    }
  });

  it('no ha vuelto el saco común que mezclaba tres enums', () => {
    // Se mira la DECLARACIÓN, no la mención: el comentario que explica por qué se
    // retiró `CONDITION_LABELS` nombra el saco a propósito, y esa historia es lo
    // único que impide que alguien la reabra pensando que nunca existió.
    expect(fuente).not.toMatch(/const CONDITION_LABELS/);
  });
});
