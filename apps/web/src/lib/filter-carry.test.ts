// A2 — la regla de preservación de filtros al cambiar de categoría.
//
// Lo que se protege aquí es que NUNCA se arrastre un atributo que el destino no acepta:
// el backend responde 400 a eso (defensa anti-leak cross-categoría de RÁFAGA 1) y la
// página se rompe. El filtrado es en cliente; el 400 del backend no se toca.

import { carryFilters, filterableAttributeNamesFor } from './filter-carry';
import type { Category } from '@/types';

const attr = (key: string, filterable: boolean) => ({
  key, label: key, showLabel: true, showUnit: true, filterable,
});

// Árbol de prueba con la forma real: 2 niveles, herencia ya resuelta por el backend
// (las hijas traen los atributos del padre en su propio allAttributes).
const TREE: Category[] = [
  {
    id: 'v', name: 'Vehículos', slug: 'vehiculos',
    allAttributes: [attr('year', true)],
    children: [
      {
        id: 'c', name: 'Coches', slug: 'coches',
        // year heredado + propios
        allAttributes: [attr('year', true), attr('fuel', true), attr('gearbox', true), attr('vin', false)],
      },
      {
        id: 'm', name: 'Motos', slug: 'motos',
        allAttributes: [attr('year', true), attr('cc', true)],
      },
    ],
  },
  {
    id: 'i', name: 'Inmobiliaria', slug: 'inmuebles',
    allAttributes: [],
    children: [
      { id: 'p', name: 'Pisos', slug: 'pisos', allAttributes: [attr('rooms', true), attr('sqm', true)] },
    ],
  },
];

describe('filterableAttributeNamesFor', () => {
  it('destino HOJA: sus filtrables, con los heredados ya dentro', () => {
    const set = filterableAttributeNamesFor(TREE, 'coches')!;
    expect([...set].sort()).toEqual(['fuel', 'gearbox', 'year']);
  });

  it('destino HOJA: excluye los NO filtrables (mandarlos también da 400)', () => {
    expect(filterableAttributeNamesFor(TREE, 'coches')!.has('vin')).toBe(false);
  });

  it('destino RAÍZ: los suyos ∪ los de TODAS sus hijas', () => {
    // Navegar /vehiculos filtra por categoryPath=vehiculos, que mezcla coches y motos,
    // así que "fuel" (solo de coches) es un filtro legítimo ahí.
    const set = filterableAttributeNamesFor(TREE, 'vehiculos')!;
    expect([...set].sort()).toEqual(['cc', 'fuel', 'gearbox', 'year']);
  });

  it('destino "Todas" (null): null = no filtrar nada, la unión global acepta todo', () => {
    expect(filterableAttributeNamesFor(TREE, null)).toBeNull();
  });

  it('slug desconocido: conservador, no arrastra ningún atributo', () => {
    expect([...filterableAttributeNamesFor(TREE, 'no-existe')!]).toEqual([]);
  });
});

describe('carryFilters — LA TRAMPA (§1.2.1)', () => {
  it('global → categoría: el atributo ajeno se CAE, no viaja y no provoca 400', () => {
    // El caso exacto del diseño: /busqueda?q=x&rooms=3&province=Madrid → Coches.
    const current = new URLSearchParams('q=x&rooms=3&province=Madrid');
    const target = { slug: 'coches', parentSlug: 'vehiculos' };
    const next = carryFilters(current, target, filterableAttributeNamesFor(TREE, 'coches'));

    expect(next.get('q')).toBe('x');
    expect(next.get('province')).toBe('Madrid');
    expect(next.has('rooms')).toBe(false);
  });

  it('categoría → otra categoría: también se cae lo que no aplica', () => {
    const current = new URLSearchParams('fuel=diesel&q=golf');
    const next = carryFilters(current, { slug: 'pisos', parentSlug: 'inmuebles' }, filterableAttributeNamesFor(TREE, 'pisos'));

    expect(next.has('fuel')).toBe(false);
    expect(next.get('q')).toBe('golf');
  });

  it('padre → hija: el atributo SÍ se conserva (el caso que ya era seguro por herencia)', () => {
    const current = new URLSearchParams('fuel=diesel');
    const next = carryFilters(current, { slug: 'coches', parentSlug: 'vehiculos' }, filterableAttributeNamesFor(TREE, 'coches'));

    expect(next.get('fuel')).toBe('diesel');
  });

  it('hija → padre: un atributo de la hija sigue valiendo en el padre', () => {
    const current = new URLSearchParams('fuel=diesel');
    const next = carryFilters(current, { slug: 'vehiculos', parentSlug: null }, filterableAttributeNamesFor(TREE, 'vehiculos'));

    expect(next.get('fuel')).toBe('diesel');
  });

  it('categoría → "Todas": TODO se conserva (la unión global lo acepta)', () => {
    const current = new URLSearchParams('fuel=diesel&rooms=3&q=x');
    const next = carryFilters(current, null, filterableAttributeNamesFor(TREE, null));

    expect(next.get('fuel')).toBe('diesel');
    expect(next.get('rooms')).toBe('3');
    expect(next.get('q')).toBe('x');
  });
});

// A4 — los extremos de rango (`km_min`) valen donde valga su atributo BASE. Sin esto se
// caerían siempre al cambiar de categoría, porque el set de permitidos contiene `km`.
describe('carryFilters — rangos numéricos (A4)', () => {
  it('conserva `year_min`/`year_max` si `year` es filtrable en el destino', () => {
    const current = new URLSearchParams('year_min=2015&year_max=2020');
    const next = carryFilters(current, { slug: 'coches', parentSlug: 'vehiculos' }, filterableAttributeNamesFor(TREE, 'coches'));

    expect(next.get('year_min')).toBe('2015');
    expect(next.get('year_max')).toBe('2020');
  });

  it('DESCARTA el rango si su atributo base no vale en el destino — y sin 400', () => {
    // `rooms` es de pisos; su rango no puede viajar a coches, igual que no viaja él.
    const current = new URLSearchParams('rooms_min=2&q=x');
    const next = carryFilters(current, { slug: 'coches', parentSlug: 'vehiculos' }, filterableAttributeNamesFor(TREE, 'coches'));

    expect(next.has('rooms_min')).toBe(false);
    expect(next.get('q')).toBe('x');
  });

  it('un extremo suelto viaja igual (rango abierto)', () => {
    const current = new URLSearchParams('year_min=2015');
    const next = carryFilters(current, { slug: 'coches', parentSlug: 'vehiculos' }, filterableAttributeNamesFor(TREE, 'coches'));

    expect(next.get('year_min')).toBe('2015');
    expect(next.has('year_max')).toBe(false);
  });

  it('hacia "Todas" se conserva todo, rangos incluidos', () => {
    const current = new URLSearchParams('rooms_min=2&year_max=2020');
    const next = carryFilters(current, null, filterableAttributeNamesFor(TREE, null));

    expect(next.get('rooms_min')).toBe('2');
    expect(next.get('year_max')).toBe('2020');
  });

  it('un atributo que TERMINA en _min pero cuya base no existe se trata como atributo normal', () => {
    // `presupuesto_min` no es el rango de nada si no hay un `presupuesto`: se comprueba
    // contra el set como cualquier otra clave, y aquí no está → se cae.
    const current = new URLSearchParams('presupuesto_min=100');
    const next = carryFilters(current, { slug: 'coches', parentSlug: 'vehiculos' }, filterableAttributeNamesFor(TREE, 'coches'));

    expect(next.has('presupuesto_min')).toBe(false);
  });
});

describe('carryFilters — core y descartes', () => {
  it('conserva todos los params core', () => {
    const current = new URLSearchParams(
      'q=x&type=PRODUCT&condition=NEW&priceType=FIXED&priceUnit=ONE_TIME&minPrice=1&maxPrice=9' +
      '&province=Madrid&city=Alcorcon&lat=40&lng=-3&radius=10&sort=price:asc&view=mapa',
    );
    const next = carryFilters(current, { slug: 'coches', parentSlug: 'vehiculos' }, filterableAttributeNamesFor(TREE, 'coches'));

    for (const [key, value] of current.entries()) {
      expect(next.get(key)).toBe(value);
    }
  });

  it('descarta `page`: cambiar de categoría es un cambio de filtro', () => {
    const current = new URLSearchParams('page=7&q=x');
    const next = carryFilters(current, { slug: 'coches', parentSlug: 'vehiculos' }, filterableAttributeNamesFor(TREE, 'coches'));

    expect(next.has('page')).toBe(false);
    expect(next.get('q')).toBe('x');
  });

  it('descarta `category`: pasa a ser el path', () => {
    const current = new URLSearchParams('category=pisos&q=x');
    const next = carryFilters(current, { slug: 'coches', parentSlug: 'vehiculos' }, filterableAttributeNamesFor(TREE, 'coches'));

    expect(next.has('category')).toBe(false);
  });

  it('descarta `condition` si el destino es SERVICE_ONLY (un servicio no está "como nuevo")', () => {
    const current = new URLSearchParams('condition=NEW&q=x');
    const next = carryFilters(
      current,
      { slug: 'coches', parentSlug: 'vehiculos', allowedListingType: 'SERVICE_ONLY' },
      filterableAttributeNamesFor(TREE, 'coches'),
    );

    expect(next.has('condition')).toBe(false);
    expect(next.get('q')).toBe('x');
  });

  it('conserva `condition` cuando el destino admite productos', () => {
    const current = new URLSearchParams('condition=NEW');
    for (const policy of ['BOTH', 'PRODUCT_ONLY'] as const) {
      const next = carryFilters(
        current,
        { slug: 'coches', parentSlug: 'vehiculos', allowedListingType: policy },
        filterableAttributeNamesFor(TREE, 'coches'),
      );
      expect(next.get('condition')).toBe('NEW');
    }
  });

  it('conserva `view` tal cual: si no aplica en el destino, resolveCurrentView cae al default', () => {
    const current = new URLSearchParams('view=mapa');
    const next = carryFilters(current, { slug: 'coches', parentSlug: 'vehiculos' }, filterableAttributeNamesFor(TREE, 'coches'));

    expect(next.get('view')).toBe('mapa');
  });

  it('no arrastra params vacíos', () => {
    const current = new URLSearchParams('q=&fuel=');
    const next = carryFilters(current, { slug: 'coches', parentSlug: 'vehiculos' }, filterableAttributeNamesFor(TREE, 'coches'));

    expect([...next.keys()]).toEqual([]);
  });
});
