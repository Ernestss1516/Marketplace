// MEJORA UX — orden de atributos solo por flechas (posición en el array,
// sin campo `order` separado).
import { fireEvent, render, screen } from '@testing-library/react';
import { AttributeSchemaEditor, type AttributeSchemaWithExtras } from './AttributeSchemaEditor';

const brand: AttributeSchemaWithExtras = {
  name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false,
};
const fuel: AttributeSchemaWithExtras = {
  name: 'fuel', label: 'Combustible', type: 'text', filterable: true, required: false,
};
const gearbox: AttributeSchemaWithExtras = {
  name: 'gearbox', label: 'Cambio', type: 'text', filterable: false, required: false,
};

const inheritedYear = { name: 'year', label: 'Año', type: 'number' as const, filterable: true, required: true };

function renderEditor(ownSchema: AttributeSchemaWithExtras[], inheritedFields: typeof inheritedYear[] = []) {
  const onChange = jest.fn();
  render(
    <AttributeSchemaEditor
      ownSchema={ownSchema}
      inheritedFields={inheritedFields}
      parentName="Vehículos"
      searchableKeys={['brand', 'fuel', 'gearbox']}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe('AttributeSchemaEditor — reordenar atributos con flechas', () => {
  it('los atributos heredados no tienen flechas de mover (ni ningún botón de acción)', () => {
    renderEditor([brand], [inheritedYear]);
    expect(screen.queryByTestId('move-up-attr-year')).not.toBeInTheDocument();
    expect(screen.queryByTestId('move-down-attr-year')).not.toBeInTheDocument();
  });

  it('el primer atributo propio tiene "Subir" deshabilitado; el último tiene "Bajar" deshabilitado', () => {
    renderEditor([brand, fuel, gearbox]);

    expect(screen.getByTestId('move-up-attr-brand')).toBeDisabled();
    expect(screen.getByTestId('move-down-attr-brand')).not.toBeDisabled();

    expect(screen.getByTestId('move-up-attr-gearbox')).not.toBeDisabled();
    expect(screen.getByTestId('move-down-attr-gearbox')).toBeDisabled();

    // El del medio no tiene ningún extremo deshabilitado.
    expect(screen.getByTestId('move-up-attr-fuel')).not.toBeDisabled();
    expect(screen.getByTestId('move-down-attr-fuel')).not.toBeDisabled();
  });

  it('"Bajar" en el primero intercambia su posición con el siguiente (swap en el array)', () => {
    const { onChange } = renderEditor([brand, fuel, gearbox]);

    fireEvent.click(screen.getByTestId('move-down-attr-brand'));

    expect(onChange).toHaveBeenCalledWith([fuel, brand, gearbox]);
  });

  it('"Subir" en el último intercambia su posición con el anterior', () => {
    const { onChange } = renderEditor([brand, fuel, gearbox]);

    fireEvent.click(screen.getByTestId('move-up-attr-gearbox'));

    expect(onChange).toHaveBeenCalledWith([brand, gearbox, fuel]);
  });

  it('mover el del medio hacia arriba y luego hacia abajo vuelve al orden original', () => {
    const { onChange } = renderEditor([brand, fuel, gearbox]);

    fireEvent.click(screen.getByTestId('move-up-attr-fuel'));
    expect(onChange).toHaveBeenLastCalledWith([fuel, brand, gearbox]);
  });
});
