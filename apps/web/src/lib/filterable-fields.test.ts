// A3 — qué filtros de atributo pinta el panel. Lo que se protege aquí es el CAMBIO DE
// EJE: la lista sale de la CONFIG (schema), no de las facetas que devuelva la búsqueda.

import { filterableFieldsForCategory, filterableFieldsForTree } from './filterable-fields';
import type { AttributeSchema, Category } from '@/types';

const arbolAttr = (
  key: string,
  filterable: boolean,
  extra: Partial<NonNullable<Category['allAttributes']>[number]> = {},
) => ({ key, label: `L-${key}`, showLabel: true, showUnit: true, filterable, ...extra });

const TREE: Category[] = [
  {
    id: 'v', name: 'Vehículos', slug: 'vehiculos',
    allAttributes: [arbolAttr('year', true, { type: 'number', unit: 'año' })],
    children: [
      {
        id: 'c', name: 'Coches', slug: 'coches',
        allAttributes: [
          arbolAttr('year', true, { type: 'number' }),
          arbolAttr('fuel', true, { type: 'select', options: ['Diésel', 'Gasolina'] }),
          arbolAttr('vin', false, { type: 'text' }),
        ],
      },
      { id: 'm', name: 'Motos', slug: 'motos', allAttributes: [arbolAttr('cc', true, { type: 'number' })] },
    ],
  },
  {
    id: 'i', name: 'Inmobiliaria', slug: 'inmuebles',
    allAttributes: [],
    children: [{ id: 'p', name: 'Pisos', slug: 'pisos', allAttributes: [arbolAttr('rooms', true, { type: 'number' })] }],
  },
];

const schema = (
  name: string,
  filterable: boolean,
  extra: Partial<AttributeSchema> = {},
): AttributeSchema => ({
  name, label: `L-${name}`, type: 'text', filterable, required: false, ...extra,
});

describe('filterableFieldsForTree (/busqueda sin categoría)', () => {
  it('une lo filtrable de TODO el árbol, raíces e hijas', () => {
    expect(filterableFieldsForTree(TREE).map((f) => f.name).sort())
      .toEqual(['cc', 'fuel', 'rooms', 'year']);
  });

  it('excluye lo NO filtrable', () => {
    expect(filterableFieldsForTree(TREE).some((f) => f.name === 'vin')).toBe(false);
  });

  it('conserva la forma del atributo (type, unit, options) — es lo que el panel necesita para pintarlo', () => {
    const fuel = filterableFieldsForTree(TREE).find((f) => f.name === 'fuel')!;
    expect(fuel).toMatchObject({ type: 'select', options: ['Diésel', 'Gasolina'], label: 'L-fuel' });
  });

  it('deduplica por nombre: `year` está en el padre y en la hija, sale una vez', () => {
    expect(filterableFieldsForTree(TREE).filter((f) => f.name === 'year')).toHaveLength(1);
  });

  it('un árbol vacío no rompe', () => {
    expect(filterableFieldsForTree([])).toEqual([]);
  });
});

describe('filterableFieldsForCategory', () => {
  it('HOJA: sus filtrables del schema efectivo (herencia ya resuelta por el backend)', () => {
    const efectivo = [schema('year', true, { type: 'number' }), schema('fuel', true, { type: 'select' })];
    expect(filterableFieldsForCategory(efectivo, TREE, 'coches').map((f) => f.name).sort())
      .toEqual(['fuel', 'year']);
  });

  it('HOJA: excluye lo no filtrable aunque esté en el schema', () => {
    const efectivo = [schema('year', true), schema('vin', false)];
    expect(filterableFieldsForCategory(efectivo, TREE, 'coches').some((f) => f.name === 'vin')).toBe(false);
  });

  it('RAÍZ: los suyos MÁS los de todas sus hijas', () => {
    // Navegar /vehiculos mezcla los anuncios de coches y motos (categoryPath), así que
    // "fuel" y "cc" son filtros legítimos ahí — misma regla que el backend.
    const propio = [schema('year', true, { type: 'number' })];
    expect(filterableFieldsForCategory(propio, TREE, 'vehiculos').map((f) => f.name).sort())
      .toEqual(['cc', 'fuel', 'year']);
  });

  it('RAÍZ: no se lleva atributos de OTRA rama', () => {
    const propio = [schema('year', true)];
    expect(filterableFieldsForCategory(propio, TREE, 'vehiculos').some((f) => f.name === 'rooms')).toBe(false);
  });

  it('si una hija redefine un atributo del padre, manda la definición de la categoría mirada', () => {
    const propio = [schema('year', true, { type: 'number', label: 'Año del padre' })];
    const year = filterableFieldsForCategory(propio, TREE, 'vehiculos').find((f) => f.name === 'year')!;
    expect(year.label).toBe('Año del padre');
  });

  it('sin árbol (fallo de la API) usa solo el schema, no rompe', () => {
    const propio = [schema('year', true)];
    expect(filterableFieldsForCategory(propio, [], 'vehiculos').map((f) => f.name)).toEqual(['year']);
  });

  it('propaga dependsOn/optionsByParent para los selects vinculados', () => {
    const propio = [
      schema('brand', true, { type: 'select', options: ['Seat'] }),
      schema('model', true, { type: 'select', dependsOn: 'brand', optionsByParent: { Seat: ['Ibiza'] } }),
    ];
    const model = filterableFieldsForCategory(propio, [], 'coches').find((f) => f.name === 'model')!;
    expect(model).toMatchObject({ dependsOn: 'brand', optionsByParent: { Seat: ['Ibiza'] } });
  });
});
