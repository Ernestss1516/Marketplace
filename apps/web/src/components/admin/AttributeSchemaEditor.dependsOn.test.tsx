// NUEVA FEATURE — selects vinculados (Marca/Modelo): editor admin de
// `dependsOn` / `optionsByParent`. Mecanismo genérico, demostrado con un
// caso mínimo (2 marcas, 2-3 modelos cada una) — no el catálogo completo.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AttributeSchemaEditor, type AttributeSchemaWithExtras } from './AttributeSchemaEditor';

const brandField: AttributeSchemaWithExtras = {
  name: 'brand',
  label: 'Marca',
  type: 'select',
  filterable: true,
  required: false,
  options: ['Seat', 'BMW'],
};

const modelField: AttributeSchemaWithExtras = {
  name: 'model',
  label: 'Modelo',
  type: 'select',
  filterable: true,
  required: false,
  dependsOn: 'brand',
  optionsByParent: { Seat: ['Ibiza', 'León'], BMW: ['Serie 1'] },
};

function renderEditor(ownSchema: AttributeSchemaWithExtras[] = []) {
  const onChange = jest.fn();
  render(
    <AttributeSchemaEditor
      ownSchema={ownSchema}
      inheritedFields={[]}
      searchableKeys={['brand', 'model', 'color']}
      onChange={onChange}
    />,
  );
  return { onChange };
}

function addOptionToLinkedParent(parentValue: string, value: string) {
  const input = screen.getByTestId(`linked-option-input-${parentValue}`);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('AttributeSchemaEditor — selects vinculados (dependsOn / optionsByParent)', () => {
  it('un select recién creado no tiene aún candidatos a padre disponibles más que otros selects (excluyéndose a sí mismo)', () => {
    renderEditor([]);
    fireEvent.click(screen.getByTestId('add-attribute-btn'));
    fireEvent.change(screen.getByTestId('attr-type-select'), { target: { value: 'select' } });

    const dependsOnSelect = screen.getByTestId('attr-depends-on-select') as HTMLSelectElement;
    const optionValues = Array.from(dependsOnSelect.options).map((o) => o.value);
    expect(optionValues).toEqual(['']); // solo "Ninguno" — no hay otros selects propios aún
  });

  it('crear Marca (select plano) y luego Modelo vinculado a Marca → se guarda con dependsOn + optionsByParent', async () => {
    const { onChange } = renderEditor([]);

    // 1) Crear "brand" como select plano con opciones Seat/BMW.
    fireEvent.click(screen.getByTestId('add-attribute-btn'));
    fireEvent.change(screen.getByTestId('attr-name-input'), { target: { value: 'brand' } });
    fireEvent.change(screen.getByTestId('attr-label-input'), { target: { value: 'Marca' } });
    fireEvent.change(screen.getByTestId('attr-type-select'), { target: { value: 'select' } });
    fireEvent.change(screen.getByTestId('option-input'), { target: { value: 'Seat' } });
    fireEvent.click(screen.getByText('Añadir'));
    fireEvent.change(screen.getByTestId('option-input'), { target: { value: 'BMW' } });
    fireEvent.click(screen.getByText('Añadir'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    // 2) Crear "model" vinculado a "brand".
    fireEvent.click(screen.getByTestId('add-attribute-btn'));
    fireEvent.change(screen.getByTestId('attr-name-input'), { target: { value: 'model' } });
    fireEvent.change(screen.getByTestId('attr-label-input'), { target: { value: 'Modelo' } });
    fireEvent.change(screen.getByTestId('attr-type-select'), { target: { value: 'select' } });
    fireEvent.change(screen.getByTestId('attr-depends-on-select'), { target: { value: 'brand' } });

    // El editor de opciones planas desaparece; aparece el editor vinculado
    // con un sub-editor por cada opción actual de "brand".
    expect(screen.queryByTestId('options-editor')).not.toBeInTheDocument();
    expect(screen.getByTestId('linked-options-editor')).toBeInTheDocument();

    addOptionToLinkedParent('Seat', 'Ibiza');
    addOptionToLinkedParent('Seat', 'León');
    addOptionToLinkedParent('BMW', 'Serie 1');

    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: 'brand', type: 'select', options: ['Seat', 'BMW'] }),
      expect.objectContaining({
        name: 'model',
        type: 'select',
        dependsOn: 'brand',
        optionsByParent: { Seat: ['Ibiza', 'León'], BMW: ['Serie 1'] },
      }),
    ]);
    // dependsOn implica que `options` (plano) no se persiste para ese campo.
    const [, savedModel] = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(savedModel.options).toBeUndefined();
  });

  it('dependsOn sin ninguna opción rellenada en optionsByParent → error de validación, no guarda', async () => {
    const { onChange } = renderEditor([brandField]);

    fireEvent.click(screen.getByTestId('add-attribute-btn'));
    fireEvent.change(screen.getByTestId('attr-name-input'), { target: { value: 'model' } });
    fireEvent.change(screen.getByTestId('attr-label-input'), { target: { value: 'Modelo' } });
    fireEvent.change(screen.getByTestId('attr-type-select'), { target: { value: 'select' } });
    fireEvent.change(screen.getByTestId('attr-depends-on-select'), { target: { value: 'brand' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    expect(
      screen.getByText('Añade al menos una opción para algún valor del atributo del que depende'),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('un select con su propio dependsOn no aparece como candidato a padre de un tercer campo (sin cadenas)', () => {
    renderEditor([brandField, modelField]);

    fireEvent.click(screen.getByTestId('add-attribute-btn'));
    fireEvent.change(screen.getByTestId('attr-type-select'), { target: { value: 'select' } });

    const dependsOnSelect = screen.getByTestId('attr-depends-on-select') as HTMLSelectElement;
    const optionValues = Array.from(dependsOnSelect.options).map((o) => o.value);
    expect(optionValues).toEqual(['', 'brand']); // "model" queda excluido: ya tiene su propio dependsOn
  });

  it('dependsOn roto (el padre ya no existe entre los candidatos) se trata como select plano — tolerante, no bloquea', async () => {
    const brokenModel: AttributeSchemaWithExtras = {
      name: 'model',
      label: 'Modelo',
      type: 'select',
      filterable: true,
      required: false,
      dependsOn: 'discontinued', // ya no existe ningún select con este name
    };
    const { onChange } = renderEditor([brokenModel]);

    fireEvent.click(screen.getByTestId('edit-attr-model'));

    expect(
      screen.getByText(/ya no está disponible — se guardará como select plano/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('linked-options-editor')).not.toBeInTheDocument();
    expect(screen.getByTestId('options-editor')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('option-input'), { target: { value: 'Básico' } });
    fireEvent.click(screen.getByText('Añadir'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'model', options: ['Básico'] }),
    ]);
    const [saved] = onChange.mock.calls[0][0];
    expect(saved.dependsOn).toBeUndefined();
    expect(saved.optionsByParent).toBeUndefined();
  });
});
