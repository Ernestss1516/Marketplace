// RÁFAGA 3 (display de atributos en card) — checkboxes showLabel/showUnit por
// atributo. Dos ejes independientes, no un enum de 3 modos: la unidad no es
// alternativa al nombre, es parte del valor formateado.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AttributeSchemaEditor, type AttributeSchemaWithExtras } from './AttributeSchemaEditor';

const kmField: AttributeSchemaWithExtras = {
  name: 'km',
  label: 'Kilometraje',
  type: 'number',
  unit: 'km',
  filterable: false,
  required: false,
};

const roomsField: AttributeSchemaWithExtras = {
  name: 'rooms',
  label: 'Habitaciones',
  type: 'number',
  filterable: false,
  required: false,
};

function renderEditor(ownSchema: AttributeSchemaWithExtras[] = []) {
  const onChange = jest.fn();
  render(
    <AttributeSchemaEditor
      ownSchema={ownSchema}
      inheritedFields={[]}
      searchableKeys={['km', 'rooms']}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe('AttributeSchemaEditor — showLabel / showUnit', () => {
  it('atributo CON unidad sin configurar: showLabel desmarcado, showUnit marcado (reproduce la regla anterior)', () => {
    renderEditor([kmField]);
    fireEvent.click(screen.getByTestId('edit-attr-km'));

    expect(screen.getByTestId('show-label-checkbox')).not.toBeChecked();
    expect(screen.getByTestId('show-unit-checkbox')).toBeChecked();
    expect(screen.getByTestId('attr-preview')).toHaveTextContent('150.000 km');
  });

  it('atributo SIN unidad sin configurar: showLabel marcado, showUnit no se muestra (no hay unidad)', () => {
    renderEditor([roomsField]);
    fireEvent.click(screen.getByTestId('edit-attr-rooms'));

    expect(screen.getByTestId('show-label-checkbox')).toBeChecked();
    expect(screen.queryByTestId('show-unit-checkbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('attr-preview')).toHaveTextContent('Habitaciones: 150.000');
  });

  it('sin tocar los checkboxes, guardar un atributo con unidad NO añade showLabel/showUnit al payload (byte-idéntico)', async () => {
    const { onChange } = renderEditor([kmField]);
    fireEvent.click(screen.getByTestId('edit-attr-km'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.not.objectContaining({ showLabel: expect.anything(), showUnit: expect.anything() }),
    ]);
  });

  it('marcar showLabel en un atributo con unidad → se guarda showLabel:true; las 4 combinaciones se reflejan en la vista previa', async () => {
    const { onChange } = renderEditor([kmField]);
    fireEvent.click(screen.getByTestId('edit-attr-km'));

    // Combinación por defecto: "150.000 km" (showLabel=false, showUnit=true)
    expect(screen.getByTestId('attr-preview')).toHaveTextContent('150.000 km');

    // showLabel=true, showUnit=true → "Kilometraje: 150.000 km"
    fireEvent.click(screen.getByTestId('show-label-checkbox'));
    expect(screen.getByTestId('attr-preview')).toHaveTextContent('Kilometraje: 150.000 km');

    // showLabel=true, showUnit=false → "Kilometraje: 150.000"
    fireEvent.click(screen.getByTestId('show-unit-checkbox'));
    expect(screen.getByTestId('attr-preview')).toHaveTextContent('Kilometraje: 150.000');
    expect(screen.getByTestId('attr-preview')).not.toHaveTextContent('km');

    // showLabel=false, showUnit=false → "150.000"
    fireEvent.click(screen.getByTestId('show-label-checkbox'));
    expect(screen.getByTestId('attr-preview')).toHaveTextContent('150.000');

    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    // Estado final: showLabel=false, showUnit=false. showLabel=false COINCIDE con el
    // default de un atributo con unidad (se omite, byte-idéntico); showUnit=false SÍ
    // difiere del default (true) y se persiste explícitamente.
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'km', showUnit: false }),
    ]);
    expect(onChange.mock.calls[0][0][0]).not.toHaveProperty('showLabel');
  });

  it('atributo nuevo sin unidad con showUnit=true (imposible de marcar en la UI, pero tolerado si viene de datos): no rompe', () => {
    const fieldWithStrayShowUnit: AttributeSchemaWithExtras = {
      ...roomsField,
      showUnit: true, // dato preexistente de una edición anterior a quitar la unidad
    };
    renderEditor([fieldWithStrayShowUnit]);
    fireEvent.click(screen.getByTestId('edit-attr-rooms'));

    // showUnit checkbox no se muestra (no hay unidad) pero la preview no rompe
    expect(screen.queryByTestId('show-unit-checkbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('attr-preview')).toHaveTextContent('Habitaciones: 150.000');
  });
});
