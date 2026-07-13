// RÁFAGA 3 (bugfix) — buildCardAttributeMap/buildWideCardAttributeMap/
// buildFullAttributeMap deben devolver una entrada por CADA categoría del
// árbol (padres Y hojas), no solo una. Esto es lo que arregla el bug de
// /[categoria]: al navegar una categoría PADRE (p. ej. /vehiculos, que mezcla
// anuncios de sus hijas coches/motos vía categoryPath de Meilisearch), cada
// listing trae el categorySlug de su propia hoja — si el mapa solo tuviera la
// entrada del padre, CardAttrsDisplay no encontraría nada para esos listings.
import {
  buildCardAttributeMap,
  buildWideCardAttributeMap,
  buildFullAttributeMap,
  filterDefsByListingType,
} from './card-attributes';
import type { Category, CardAttributeDef } from '@/types';

const tree: Category[] = [
  {
    id: 'p1',
    name: 'Vehículos',
    slug: 'vehiculos',
    cardAttributes: [{ key: 'brand', label: 'Marca', showLabel: true, showUnit: true }],
    wideCardAttributes: [],
    allAttributes: [{ key: 'brand', label: 'Marca', showLabel: true, showUnit: true }],
    children: [
      {
        id: 'c1',
        name: 'Coches',
        slug: 'coches',
        cardAttributes: [{ key: 'km', label: 'Kilómetros', unit: 'km', showLabel: false, showUnit: true }],
        wideCardAttributes: [
          { key: 'fuel', label: 'Combustible', showLabel: true, showUnit: true },
          { key: 'gearbox', label: 'Cambio', showLabel: true, showUnit: true },
        ],
        allAttributes: [
          { key: 'km', label: 'Kilómetros', unit: 'km', showLabel: false, showUnit: true },
          { key: 'fuel', label: 'Combustible', showLabel: true, showUnit: true },
        ],
      },
      {
        id: 'c2',
        name: 'Motos',
        slug: 'motos',
        cardAttributes: [{ key: 'displacement', label: 'Cilindrada', unit: 'cc', showLabel: false, showUnit: true }],
        wideCardAttributes: [],
        allAttributes: [{ key: 'displacement', label: 'Cilindrada', unit: 'cc', showLabel: false, showUnit: true }],
      },
    ],
  },
];

describe('buildCardAttributeMap — una entrada por categoría (padre Y cada hija)', () => {
  it('el padre tiene su propia entrada', () => {
    const map = buildCardAttributeMap(tree);
    expect(map.vehiculos).toEqual([{ key: 'brand', label: 'Marca', showLabel: true, showUnit: true }]);
  });

  it('CADA hija tiene su PROPIA entrada, distinta de la del padre — esto es lo que arregla el bug', () => {
    const map = buildCardAttributeMap(tree);
    expect(map.coches).toEqual([{ key: 'km', label: 'Kilómetros', unit: 'km', showLabel: false, showUnit: true }]);
    expect(map.motos).toEqual([
      { key: 'displacement', label: 'Cilindrada', unit: 'cc', showLabel: false, showUnit: true },
    ]);
    // Las hijas NO comparten la entrada del padre.
    expect(map.coches).not.toEqual(map.vehiculos);
  });

  it('una categoría hija con cardAttributes vacío no añade clave (mismo criterio que antes)', () => {
    const treeWithEmpty: Category[] = [
      { id: 'x', name: 'X', slug: 'x', cardAttributes: [], wideCardAttributes: [], allAttributes: [], children: [] },
    ];
    expect(buildCardAttributeMap(treeWithEmpty)).toEqual({});
  });
});

describe('buildWideCardAttributeMap — mismo criterio de árbol completo', () => {
  it('solo coches tiene wideCardAttributes; vehiculos y motos no aparecen como clave', () => {
    const map = buildWideCardAttributeMap(tree);
    expect(map.coches).toEqual([
      { key: 'fuel', label: 'Combustible', showLabel: true, showUnit: true },
      { key: 'gearbox', label: 'Cambio', showLabel: true, showUnit: true },
    ]);
    expect(map.vehiculos).toBeUndefined();
    expect(map.motos).toBeUndefined();
  });
});

describe('buildFullAttributeMap — todas las hojas Y el padre, cada una con su propio allAttributes', () => {
  it('padre e hijas tienen entradas independientes con TODOS sus atributos', () => {
    const map = buildFullAttributeMap(tree);
    expect(map.vehiculos).toEqual([{ key: 'brand', label: 'Marca', showLabel: true, showUnit: true }]);
    expect(map.coches).toEqual([
      { key: 'km', label: 'Kilómetros', unit: 'km', showLabel: false, showUnit: true },
      { key: 'fuel', label: 'Combustible', showLabel: true, showUnit: true },
    ]);
    expect(map.motos).toEqual([
      { key: 'displacement', label: 'Cilindrada', unit: 'cc', showLabel: false, showUnit: true },
    ]);
  });
});

describe('filterDefsByListingType — ATRIBUTOS EN CARD respetar producto/servicio', () => {
  const km: CardAttributeDef = { key: 'km', label: 'Kilometraje', showLabel: false, showUnit: true, appliesTo: ['PRODUCT'] };
  const rate: CardAttributeDef = { key: 'rate', label: 'Tarifa/hora', showLabel: true, showUnit: true, appliesTo: ['SERVICE'] };
  const brand: CardAttributeDef = { key: 'brand', label: 'Marca', showLabel: true, showUnit: true }; // sin appliesTo = ambos
  const defs = [km, rate, brand];

  it('un anuncio de PRODUCTO ve solo los de producto + los de ambos', () => {
    expect(filterDefsByListingType(defs, 'PRODUCT')).toEqual([km, brand]);
  });

  it('un anuncio de SERVICIO ve solo los de servicio + los de ambos — nunca "Kilometraje"', () => {
    const result = filterDefsByListingType(defs, 'SERVICE');
    expect(result).toEqual([rate, brand]);
    expect(result.find((d) => d.key === 'km')).toBeUndefined();
  });

  it('sin listingType (defensivo) → no filtra, devuelve todo', () => {
    expect(filterDefsByListingType(defs, undefined)).toEqual(defs);
  });
});
