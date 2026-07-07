import { filterSchemaByType } from './attribute-schema';
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
