import {
  AttributeField,
  countAttributesByType,
  DEFAULT_ALLOWED_PRICE_UNITS,
  DEFAULT_EFFECTIVE_VIEWS,
  filterSchemaByType,
  isListingTypeAllowed,
  isPriceUnitAllowed,
  resolveEffectivePolicy,
  resolveEffectivePriceUnits,
  resolveEffectiveViews,
  resolveLinkedOptions,
  resolveShowLabel,
  resolveShowUnit,
} from './category.types';

function attr(overrides: Partial<AttributeField> = {}): AttributeField {
  return { name: 'km', label: 'Kilometraje', type: 'number', filterable: false, required: false, ...overrides };
}

describe('resolveShowLabel / resolveShowUnit (RÁFAGA 3 — display de atributos en card)', () => {
  it('sin showLabel explícito y CON unidad → false (reproduce la regla hardcodeada anterior)', () => {
    expect(resolveShowLabel(attr({ unit: 'km' }))).toBe(false);
  });

  it('sin showLabel explícito y SIN unidad → true (reproduce la regla hardcodeada anterior)', () => {
    expect(resolveShowLabel(attr({ unit: undefined }))).toBe(true);
  });

  it('showLabel explícito manda siempre, tenga o no unidad', () => {
    expect(resolveShowLabel(attr({ unit: 'km', showLabel: true }))).toBe(true);
    expect(resolveShowLabel(attr({ unit: undefined, showLabel: false }))).toBe(false);
  });

  it('sin showUnit explícito → true, con o sin unidad (moot sin unidad)', () => {
    expect(resolveShowUnit(attr({ unit: 'km' }))).toBe(true);
    expect(resolveShowUnit(attr({ unit: undefined }))).toBe(true);
  });

  it('showUnit explícito manda siempre', () => {
    expect(resolveShowUnit(attr({ unit: 'km', showUnit: false }))).toBe(false);
  });

  it('las 4 combinaciones son independientes entre sí', () => {
    const base = { unit: 'km' };
    expect(resolveShowLabel(attr({ ...base, showLabel: true }))).toBe(true);
    expect(resolveShowUnit(attr({ ...base, showUnit: true }))).toBe(true);
    expect(resolveShowLabel(attr({ ...base, showLabel: false }))).toBe(false);
    expect(resolveShowUnit(attr({ ...base, showUnit: true }))).toBe(true);
    expect(resolveShowLabel(attr({ ...base, showLabel: true }))).toBe(true);
    expect(resolveShowUnit(attr({ ...base, showUnit: false }))).toBe(false);
    expect(resolveShowLabel(attr({ ...base, showLabel: false }))).toBe(false);
    expect(resolveShowUnit(attr({ ...base, showUnit: false }))).toBe(false);
  });
});

describe('resolveEffectiveViews', () => {
  it('categoría con config propia → esa config manda tal cual (defaultView explícito)', () => {
    const result = resolveEffectiveViews(
      { allowedViews: ['LISTA', 'MAPA'], defaultView: 'MAPA' },
      null,
    );
    expect(result).toEqual({ allowedViews: ['LISTA', 'MAPA'], defaultView: 'MAPA' });
  });

  it('config propia sin defaultView explícito → usa el primero de allowedViews', () => {
    const result = resolveEffectiveViews(
      { allowedViews: ['AMPLIADA', 'MAPA'], defaultView: null },
      null,
    );
    expect(result.defaultView).toBe('AMPLIADA');
  });

  it('sin config propia (subcategoría) → hereda íntegra la del padre, sin fusionar', () => {
    const parentEffective = { allowedViews: ['LISTA' as const, 'MAPA' as const], defaultView: 'MAPA' as const };
    const result = resolveEffectiveViews({ allowedViews: [], defaultView: null }, parentEffective);
    expect(result).toEqual(parentEffective);
  });

  it('sin config propia NI del padre → cae al default global (las 3, LISTA por defecto)', () => {
    const result = resolveEffectiveViews({ allowedViews: [], defaultView: null }, null);
    expect(result).toEqual(DEFAULT_EFFECTIVE_VIEWS);
  });

  it('config propia siempre reemplaza al padre por completo (no hay fusión parcial)', () => {
    const parentEffective = { allowedViews: ['LISTA' as const, 'AMPLIADA' as const, 'MAPA' as const], defaultView: 'LISTA' as const };
    const result = resolveEffectiveViews(
      { allowedViews: ['MAPA'], defaultView: 'MAPA' },
      parentEffective,
    );
    expect(result).toEqual({ allowedViews: ['MAPA'], defaultView: 'MAPA' });
  });
});

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

describe('countAttributesByType (ATRIBUTOS EN CARD — respetar producto/servicio)', () => {
  const km: AttributeField = {
    name: 'km', label: 'Kilometraje', type: 'number', filterable: false, required: false,
    cardAttribute: true, appliesTo: ['PRODUCT'],
  };
  const year: AttributeField = {
    name: 'year', label: 'Año', type: 'number', filterable: false, required: false,
    cardAttribute: true, appliesTo: ['PRODUCT'],
  };
  const rate: AttributeField = {
    name: 'rate', label: 'Tarifa/hora', type: 'number', filterable: false, required: false,
    cardAttribute: true, appliesTo: ['SERVICE'],
  };
  const displacement: AttributeField = {
    name: 'displacement', label: 'Desplazamiento', type: 'number', filterable: false, required: false,
    cardAttribute: true, appliesTo: ['SERVICE'],
  };
  const brand: AttributeField = {
    name: 'brand', label: 'Marca', type: 'text', filterable: false, required: false,
    cardAttribute: true, // sin appliesTo → cuenta en ambos
  };
  const notFlagged: AttributeField = {
    name: 'color', label: 'Color', type: 'text', filterable: false, required: false,
    appliesTo: ['PRODUCT'], // no tiene cardAttribute → no debe contar
  };

  it('4 marcados (2 PRODUCT + 2 SERVICE) → 2 y 2, no 4 — el caso central del bug', () => {
    const counts = countAttributesByType([km, year, rate, displacement], 'cardAttribute');
    expect(counts).toEqual({ PRODUCT: 2, SERVICE: 2 });
  });

  it('un atributo sin appliesTo (ambos) cuenta en las dos cuentas', () => {
    const counts = countAttributesByType([km, brand], 'cardAttribute');
    expect(counts).toEqual({ PRODUCT: 2, SERVICE: 1 });
  });

  it('ignora atributos sin el flag marcado', () => {
    const counts = countAttributesByType([km, notFlagged], 'cardAttribute');
    expect(counts).toEqual({ PRODUCT: 1, SERVICE: 0 });
  });

  it('wideCardAttribute se cuenta de forma independiente de cardAttribute', () => {
    const wideOnly: AttributeField = { ...km, cardAttribute: undefined, wideCardAttribute: true };
    expect(countAttributesByType([wideOnly], 'cardAttribute')).toEqual({ PRODUCT: 0, SERVICE: 0 });
    expect(countAttributesByType([wideOnly], 'wideCardAttribute')).toEqual({ PRODUCT: 1, SERVICE: 0 });
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

// ─── RP.1 — formatos de precio por categoría ────────────────────────────────

describe('resolveEffectivePriceUnits — herencia de formatos de precio (RP.1)', () => {
  it('sin config propia ni de padre → default global [ONE_TIME] (el comportamiento anterior a RP.1)', () => {
    expect(resolveEffectivePriceUnits([], null)).toEqual(['ONE_TIME']);
    expect(resolveEffectivePriceUnits([], null)).toEqual(DEFAULT_ALLOWED_PRICE_UNITS);
  });

  it('config propia → gana sobre todo lo demás', () => {
    expect(resolveEffectivePriceUnits(['PER_HOUR', 'PER_DAY'], null)).toEqual([
      'PER_HOUR',
      'PER_DAY',
    ]);
  });

  it('sin config propia → hereda la del padre', () => {
    expect(resolveEffectivePriceUnits([], ['PER_MONTH'])).toEqual(['PER_MONTH']);
  });

  it('override TOTAL, no fusión: la lista propia sustituye la del padre, no se suma a ella', () => {
    // El caso real del diseño: Inmobiliaria [ONE_TIME] → Alquiler [PER_MONTH].
    // La hija NO acaba con [ONE_TIME, PER_MONTH]; solo ofrece PER_MONTH.
    expect(resolveEffectivePriceUnits(['PER_MONTH'], ['ONE_TIME'])).toEqual(['PER_MONTH']);
  });

  it('el hijo puede ofrecer formatos que el padre no permite (no es una jerarquía de restricción, a diferencia de allowedListingType)', () => {
    const effective = resolveEffectivePriceUnits(['PER_MONTH'], ['ONE_TIME']);
    expect(isPriceUnitAllowed(effective, 'PER_MONTH')).toBe(true);
    expect(isPriceUnitAllowed(effective, 'ONE_TIME')).toBe(false);
  });

  it('padre con lista vacía → no tapa el default global', () => {
    expect(resolveEffectivePriceUnits([], [])).toEqual([]);
    // Y en la composición real de dos pasos que usan findBySlug/listings.service,
    // el padre se resuelve primero contra null: [] → [ONE_TIME].
    const parentEffective = resolveEffectivePriceUnits([], null);
    expect(resolveEffectivePriceUnits([], parentEffective)).toEqual(['ONE_TIME']);
  });

  it('es pura: no muta las listas que recibe ni devuelve el array constante por referencia mutable', () => {
    const own: ('ONE_TIME' | 'PER_HOUR')[] = [];
    const parent = ['PER_HOUR' as const];
    resolveEffectivePriceUnits(own, parent);
    expect(own).toEqual([]);
    expect(parent).toEqual(['PER_HOUR']);
  });
});

describe('isPriceUnitAllowed', () => {
  it('true si el formato está en la lista resuelta', () => {
    expect(isPriceUnitAllowed(['ONE_TIME', 'PER_MONTH'], 'PER_MONTH')).toBe(true);
  });

  it('false si no está', () => {
    expect(isPriceUnitAllowed(['ONE_TIME'], 'PER_HOUR')).toBe(false);
  });

  it('lista vacía no permite nada', () => {
    expect(isPriceUnitAllowed([], 'ONE_TIME')).toBe(false);
  });

  it('el default global permite ONE_TIME y solo ONE_TIME', () => {
    expect(isPriceUnitAllowed(DEFAULT_ALLOWED_PRICE_UNITS, 'ONE_TIME')).toBe(true);
    expect(isPriceUnitAllowed(DEFAULT_ALLOWED_PRICE_UNITS, 'PER_MONTH')).toBe(false);
  });
});
