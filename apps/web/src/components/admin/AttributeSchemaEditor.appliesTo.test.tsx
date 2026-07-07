// RÁFAGA 2 (admin de categorías) — checkboxes appliesTo por atributo.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AttributeSchemaEditor, type AttributeSchemaWithExtras } from './AttributeSchemaEditor';

const serviceOnlyField: AttributeSchemaWithExtras = {
  name: 'specialty',
  label: 'Especialidad',
  type: 'text',
  filterable: true,
  required: false,
  appliesTo: ['SERVICE'],
};

function renderEditor(ownSchema: AttributeSchemaWithExtras[] = []) {
  const onChange = jest.fn();
  render(
    <AttributeSchemaEditor
      ownSchema={ownSchema}
      inheritedFields={[]}
      searchableKeys={['fuel', 'brand', 'specialty']}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe('AttributeSchemaEditor — appliesTo', () => {
  it('atributo nuevo: ambos checkboxes marcados por defecto y appliesTo se omite al guardar (byte-idéntico)', async () => {
    const { onChange } = renderEditor();

    fireEvent.click(screen.getByTestId('add-attribute-btn'));
    fireEvent.change(screen.getByTestId('attr-name-input'), { target: { value: 'color' } });
    fireEvent.change(screen.getByTestId('attr-label-input'), { target: { value: 'Color' } });

    expect(screen.getByTestId('applies-to-product-checkbox')).toBeChecked();
    expect(screen.getByTestId('applies-to-service-checkbox')).toBeChecked();

    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.not.objectContaining({ appliesTo: expect.anything() }),
    ]);
  });

  it('desmarcar Servicio → appliesTo se guarda como [PRODUCT]', async () => {
    const { onChange } = renderEditor();

    fireEvent.click(screen.getByTestId('add-attribute-btn'));
    fireEvent.change(screen.getByTestId('attr-name-input'), { target: { value: 'warrantyMonths' } });
    fireEvent.change(screen.getByTestId('attr-label-input'), { target: { value: 'Meses de garantía' } });
    fireEvent.click(screen.getByTestId('applies-to-service-checkbox'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'warrantyMonths', appliesTo: ['PRODUCT'] }),
    ]);
  });

  it('desmarcar ambos tipos → error de validación, no llama a onChange', async () => {
    const { onChange } = renderEditor();

    fireEvent.click(screen.getByTestId('add-attribute-btn'));
    fireEvent.change(screen.getByTestId('attr-name-input'), { target: { value: 'color' } });
    fireEvent.change(screen.getByTestId('attr-label-input'), { target: { value: 'Color' } });
    fireEvent.click(screen.getByTestId('applies-to-product-checkbox'));
    fireEvent.click(screen.getByTestId('applies-to-service-checkbox'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    expect(screen.getByText('Selecciona al menos un tipo (Producto o Servicio)')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('atributo existente con appliesTo:[SERVICE] precarga solo el checkbox Servicio', () => {
    renderEditor([serviceOnlyField]);

    fireEvent.click(screen.getByTestId('edit-attr-specialty'));

    expect(screen.getByTestId('applies-to-product-checkbox')).not.toBeChecked();
    expect(screen.getByTestId('applies-to-service-checkbox')).toBeChecked();
  });

  it('re-marcar Producto en un atributo [SERVICE] → appliesTo se omite (vuelve a "ambos")', async () => {
    const { onChange } = renderEditor([serviceOnlyField]);

    fireEvent.click(screen.getByTestId('edit-attr-specialty'));
    fireEvent.click(screen.getByTestId('applies-to-product-checkbox'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.not.objectContaining({ appliesTo: expect.anything() }),
    ]);
  });
});
