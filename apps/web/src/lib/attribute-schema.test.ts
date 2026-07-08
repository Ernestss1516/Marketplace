import { filterSchemaByType, resolveLinkedOptions } from './attribute-schema';
import type { AttributeSchema } from '@/types';

const common: AttributeSchema = {
  name: 'brand', label: 'Marca', type: 'text', filterable: false, required: false,
};
const productOnly: AttributeSchema = {
  name: 'warranty', label: 'Garantía', type: 'text', filterable: false, required: false,
  appliesTo: ['PRODUCT'],
};
const serviceOnly: AttributeSchema = {
  name: 'specialty', label: 'Especialidad', type: 'text', filterable: false, required: false,
  appliesTo: ['SERVICE'],
};

describe('filterSchemaByType', () => {
  it('un atributo sin appliesTo aparece para ambos tipos', () => {
    expect(filterSchemaByType([common], 'PRODUCT')).toEqual([common]);
    expect(filterSchemaByType([common], 'SERVICE')).toEqual([common]);
  });

  it('un atributo solo-PRODUCT no aparece para SERVICE', () => {
    expect(filterSchemaByType([productOnly], 'SERVICE')).toEqual([]);
  });

  it('un atributo solo-SERVICE no aparece para PRODUCT', () => {
    expect(filterSchemaByType([serviceOnly], 'PRODUCT')).toEqual([]);
  });

  it('mezcla realista: cada tipo ve lo suyo + lo común', () => {
    const schema = [common, productOnly, serviceOnly];
    expect(filterSchemaByType(schema, 'PRODUCT')).toEqual([common, productOnly]);
    expect(filterSchemaByType(schema, 'SERVICE')).toEqual([common, serviceOnly]);
  });

  it("type === '' (aún no decidido) no filtra nada", () => {
    const schema = [common, productOnly, serviceOnly];
    expect(filterSchemaByType(schema, '')).toEqual(schema);
  });
});

describe('resolveLinkedOptions — selects vinculados (Marca/Modelo)', () => {
  const brand: AttributeSchema = {
    name: 'brand', label: 'Marca', type: 'select', filterable: true, required: false,
    options: ['Seat', 'BMW'],
  };
  const model: AttributeSchema = {
    name: 'model', label: 'Modelo', type: 'select', filterable: true, required: false,
    dependsOn: 'brand',
    optionsByParent: { Seat: ['Ibiza', 'León'], BMW: ['Serie 1', 'Serie 3'] },
  };

  it('un select plano devuelve directamente sus options, sin importar el valor de padre', () => {
    expect(resolveLinkedOptions(brand, undefined)).toEqual(['Seat', 'BMW']);
    expect(resolveLinkedOptions(brand, 'cualquiera')).toEqual(['Seat', 'BMW']);
  });

  it('select vinculado sin valor de padre → lista vacía', () => {
    expect(resolveLinkedOptions(model, undefined)).toEqual([]);
  });

  it('select vinculado con valor de padre válido → sus opciones', () => {
    expect(resolveLinkedOptions(model, 'Seat')).toEqual(['Ibiza', 'León']);
    expect(resolveLinkedOptions(model, 'BMW')).toEqual(['Serie 1', 'Serie 3']);
  });

  it('select vinculado con valor de padre sin entrada → lista vacía', () => {
    expect(resolveLinkedOptions(model, 'Renault')).toEqual([]);
  });
});
