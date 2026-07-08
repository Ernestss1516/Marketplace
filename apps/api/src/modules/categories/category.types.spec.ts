import {
  AttributeField,
  filterSchemaByType,
  isListingTypeAllowed,
  resolveEffectivePolicy,
  resolveLinkedOptions,
} from './category.types';

describe('resolveEffectivePolicy', () => {
  it('hijo BOTH → hereda la política efectiva del padre', () => {
    expect(resolveEffectivePolicy('BOTH', 'PRODUCT_ONLY')).toBe('PRODUCT_ONLY');
    expect(resolveEffectivePolicy('BOTH', 'SERVICE_ONLY')).toBe('SERVICE_ONLY');
    expect(resolveEffectivePolicy('BOTH', 'BOTH')).toBe('BOTH');
  });

  it('padre BOTH → manda la política propia del hijo (sin restricción heredada)', () => {
    expect(resolveEffectivePolicy('PRODUCT_ONLY', 'BOTH')).toBe('PRODUCT_ONLY');
    expect(resolveEffectivePolicy('SERVICE_ONLY', 'BOTH')).toBe('SERVICE_ONLY');
  });

  it('hijo y padre coinciden en la misma restricción → esa restricción', () => {
    expect(resolveEffectivePolicy('PRODUCT_ONLY', 'PRODUCT_ONLY')).toBe('PRODUCT_ONLY');
    expect(resolveEffectivePolicy('SERVICE_ONLY', 'SERVICE_ONLY')).toBe('SERVICE_ONLY');
  });

  it('contradicción real (restricciones distintas) → defensivo, gana el padre, nunca lanza', () => {
    expect(resolveEffectivePolicy('PRODUCT_ONLY', 'SERVICE_ONLY')).toBe('SERVICE_ONLY');
    expect(resolveEffectivePolicy('SERVICE_ONLY', 'PRODUCT_ONLY')).toBe('PRODUCT_ONLY');
  });
});

describe('isListingTypeAllowed', () => {
  it('BOTH permite ambos tipos', () => {
    expect(isListingTypeAllowed('BOTH', 'PRODUCT')).toBe(true);
    expect(isListingTypeAllowed('BOTH', 'SERVICE')).toBe(true);
  });

  it('PRODUCT_ONLY solo permite PRODUCT', () => {
    expect(isListingTypeAllowed('PRODUCT_ONLY', 'PRODUCT')).toBe(true);
    expect(isListingTypeAllowed('PRODUCT_ONLY', 'SERVICE')).toBe(false);
  });

  it('SERVICE_ONLY solo permite SERVICE', () => {
    expect(isListingTypeAllowed('SERVICE_ONLY', 'SERVICE')).toBe(true);
    expect(isListingTypeAllowed('SERVICE_ONLY', 'PRODUCT')).toBe(false);
  });
});

describe('filterSchemaByType', () => {
  const brand: AttributeField = {
    name: 'brand',
    label: 'Marca',
    type: 'text',
    filterable: true,
    required: false,
  };
  const specialty: AttributeField = {
    name: 'specialty',
    label: 'Especialidad',
    type: 'text',
    filterable: true,
    required: false,
    appliesTo: ['SERVICE'],
  };
  const warrantyMonths: AttributeField = {
    name: 'warrantyMonths',
    label: 'Meses de garantía',
    type: 'number',
    filterable: false,
    required: false,
    appliesTo: ['PRODUCT'],
  };

  it('un atributo sin appliesTo aparece para ambos tipos', () => {
    expect(filterSchemaByType([brand], 'PRODUCT')).toEqual([brand]);
    expect(filterSchemaByType([brand], 'SERVICE')).toEqual([brand]);
  });

  it('un atributo solo-PRODUCT no aparece para SERVICE', () => {
    const result = filterSchemaByType([warrantyMonths], 'SERVICE');
    expect(result).toEqual([]);
  });

  it('un atributo solo-SERVICE no aparece para PRODUCT', () => {
    const result = filterSchemaByType([specialty], 'PRODUCT');
    expect(result).toEqual([]);
  });

  it('mezcla realista: cada tipo ve lo suyo + lo común', () => {
    const schema = [brand, specialty, warrantyMonths];
    expect(filterSchemaByType(schema, 'PRODUCT')).toEqual([brand, warrantyMonths]);
    expect(filterSchemaByType(schema, 'SERVICE')).toEqual([brand, specialty]);
  });
});

describe('resolveLinkedOptions — selects vinculados (Marca/Modelo)', () => {
  const brandField: AttributeField = {
    name: 'brand',
    label: 'Marca',
    type: 'select',
    filterable: true,
    required: false,
    options: ['Seat', 'BMW'],
  };
  const modelField: AttributeField = {
    name: 'model',
    label: 'Modelo',
    type: 'select',
    filterable: true,
    required: false,
    dependsOn: 'brand',
    optionsByParent: {
      Seat: ['Ibiza', 'León'],
      BMW: ['Serie 1', 'Serie 3'],
    },
  };

  it('un select plano (sin dependsOn) devuelve directamente sus options, ignorando el valor de padre', () => {
    expect(resolveLinkedOptions(brandField, undefined)).toEqual(['Seat', 'BMW']);
    expect(resolveLinkedOptions(brandField, 'cualquier-cosa')).toEqual(['Seat', 'BMW']);
  });

  it('select vinculado sin valor de padre → lista vacía (aún no seleccionable)', () => {
    expect(resolveLinkedOptions(modelField, undefined)).toEqual([]);
  });

  it('select vinculado con valor de padre válido → las opciones de ese valor', () => {
    expect(resolveLinkedOptions(modelField, 'Seat')).toEqual(['Ibiza', 'León']);
    expect(resolveLinkedOptions(modelField, 'BMW')).toEqual(['Serie 1', 'Serie 3']);
  });

  it('select vinculado con valor de padre sin entrada en optionsByParent → lista vacía', () => {
    expect(resolveLinkedOptions(modelField, 'Renault')).toEqual([]);
  });

  it('composición con appliesTo: son ejes ortogonales — dependsOn/optionsByParent sobreviven a filterSchemaByType sin alterarse', () => {
    const modelProductOnly: AttributeField = { ...modelField, appliesTo: ['PRODUCT'] };
    const schema = [brandField, modelProductOnly];

    // PRODUCT ve ambos campos, y el vinculado conserva su dependsOn/optionsByParent intactos.
    const visibleForProduct = filterSchemaByType(schema, 'PRODUCT');
    expect(visibleForProduct).toEqual([brandField, modelProductOnly]);
    const model = visibleForProduct.find((f) => f.name === 'model')!;
    expect(resolveLinkedOptions(model, 'Seat')).toEqual(['Ibiza', 'León']);

    // SERVICE no ve el campo vinculado (appliesTo lo excluye) — el mecanismo
    // de selects vinculados no interfiere con el filtrado por tipo.
    const visibleForService = filterSchemaByType(schema, 'SERVICE');
    expect(visibleForService).toEqual([brandField]);
  });
});
