// ATRIBUTOS EN CARD — respetar producto/servicio. El tope de cardAttribute/
// wideCardAttribute (2 / 6) se valida POR TIPO en el admin — igual que en el
// backend (admin.service.ts) — no como una cuenta global: un atributo marcado
// para un tipo al que YA se llegó al tope se bloquea; uno marcado para un tipo
// que aún tiene hueco no, aunque el total de atributos de card ya supere 2/6.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AttributeSchemaEditor, type AttributeSchemaWithExtras } from './AttributeSchemaEditor';

const kmProductOnly: AttributeSchemaWithExtras = {
  name: 'km', label: 'Kilometraje', type: 'number', filterable: false, required: false,
  cardAttribute: true, appliesTo: ['PRODUCT'],
};
const yearProductOnly: AttributeSchemaWithExtras = {
  name: 'year', label: 'Año', type: 'number', filterable: false, required: false,
  cardAttribute: true, appliesTo: ['PRODUCT'],
};
const rateServiceOnly: AttributeSchemaWithExtras = {
  name: 'rate', label: 'Tarifa/hora', type: 'number', filterable: false, required: false,
  cardAttribute: true, appliesTo: ['SERVICE'],
};
const durationServiceOnly: AttributeSchemaWithExtras = {
  name: 'duration', label: 'Duración', type: 'number', filterable: false, required: false,
  cardAttribute: true, appliesTo: ['SERVICE'],
};

function renderEditor(ownSchema: AttributeSchemaWithExtras[]) {
  const onChange = jest.fn();
  render(
    <AttributeSchemaEditor
      ownSchema={ownSchema}
      inheritedFields={[]}
      searchableKeys={['km', 'year', 'rate', 'duration', 'brand']}
      onChange={onChange}
    />,
  );
  return { onChange };
}

function startNewAttr(name: string, label: string) {
  fireEvent.click(screen.getByTestId('add-attribute-btn'));
  fireEvent.change(screen.getByTestId('attr-name-input'), { target: { value: name } });
  fireEvent.change(screen.getByTestId('attr-label-input'), { target: { value: label } });
}

describe('AttributeSchemaEditor — tope de card por tipo, no global', () => {
  it('con 2 cardAttribute de PRODUCT ya marcados, un nuevo atributo "ambos" queda bloqueado (PRODUCT llegó al tope)', () => {
    renderEditor([kmProductOnly, yearProductOnly]);
    startNewAttr('brand', 'Marca');

    expect(screen.getByTestId('card-attribute-checkbox')).toBeDisabled();
  });

  it('...pero si se desmarca "Producto" (queda solo SERVICE) se habilita — SERVICE aún tiene hueco', () => {
    renderEditor([kmProductOnly, yearProductOnly]);
    startNewAttr('specialty', 'Especialidad');
    fireEvent.click(screen.getByTestId('applies-to-product-checkbox')); // ahora solo SERVICE

    expect(screen.getByTestId('card-attribute-checkbox')).not.toBeDisabled();
  });

  it('el caso central del bug: 2 PRODUCT + 2 SERVICE ya marcados (4 en total) → un 5º "ambos" SÍ se bloquea (ambos tipos llenos)', () => {
    renderEditor([kmProductOnly, yearProductOnly, rateServiceOnly, durationServiceOnly]);
    startNewAttr('brand', 'Marca');

    expect(screen.getByTestId('card-attribute-checkbox')).toBeDisabled();
  });

  it('las cuentas se muestran POR TIPO, no como un tope global — "Producto: 2/2 · Servicio: 0/2"', () => {
    renderEditor([kmProductOnly, yearProductOnly]);
    startNewAttr('brand', 'Marca');

    expect(screen.getByTestId('card-attribute-counts').textContent).toContain('Producto: 2/2');
    expect(screen.getByTestId('card-attribute-counts').textContent).toContain('Servicio: 0/2');
  });

  it('guardar un atributo SERVICE-only tras desmarcar Producto persiste appliesTo:["SERVICE"] y cardAttribute:true', async () => {
    const { onChange } = renderEditor([kmProductOnly, yearProductOnly]);
    startNewAttr('specialty', 'Especialidad');
    fireEvent.click(screen.getByTestId('applies-to-product-checkbox'));
    fireEvent.click(screen.getByTestId('card-attribute-checkbox'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    expect(onChange).toHaveBeenCalledWith([
      kmProductOnly,
      yearProductOnly,
      expect.objectContaining({ name: 'specialty', cardAttribute: true, appliesTo: ['SERVICE'] }),
    ]);
  });
});
