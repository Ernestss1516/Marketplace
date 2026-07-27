// CONTADORES DE ATRIBUTOS DE CARD — impacto en hijas. Aclarado con Ernest: el
// contador de la HIJA ya reflejaba lo heredado correctamente (ver auditoría
// anterior); lo que faltaba era que, al editar el PADRE, se viera el impacto
// en cada hija YA EXISTENTE — antes solo se sabía al intentar guardar
// (assertCardAttributeChangeDoesNotBreakChildren, backend). Este archivo cubre
// el contador nuevo, no la validación (ya probada en rc5-attributes.e2e-spec.ts).
import { fireEvent, render, screen } from '@testing-library/react';
import { AttributeSchemaEditor, type AttributeSchemaWithExtras } from './AttributeSchemaEditor';

const pProd: AttributeSchemaWithExtras = {
  name: 'pProd', label: 'Padre Producto', type: 'text', filterable: false, required: false,
  cardAttribute: true, appliesTo: ['PRODUCT'],
};
const pServ: AttributeSchemaWithExtras = {
  name: 'pServ', label: 'Padre Servicio', type: 'text', filterable: false, required: false,
  cardAttribute: true, appliesTo: ['SERVICE'],
};

const cochesChild = {
  name: 'Coches',
  attributeSchema: [
    { name: 'cProd', label: 'Hija Producto', type: 'text' as const, filterable: false, required: false, cardAttribute: true, appliesTo: ['PRODUCT' as const] },
  ],
};
const motosChild = {
  name: 'Motos',
  attributeSchema: [],
};

function renderEditor(ownSchema: AttributeSchemaWithExtras[], childCategories?: typeof cochesChild[]) {
  const onChange = jest.fn();
  render(
    <AttributeSchemaEditor
      ownSchema={ownSchema}
      inheritedFields={[]}
      searchableKeys={['pProd', 'pServ', 'cProd']}
      onChange={onChange}
      childCategories={childCategories}
    />,
  );
  return { onChange };
}

describe('AttributeSchemaEditor — impacto en subcategorías (contador, editando el PADRE)', () => {
  it('sin childCategories (categoría hoja, o raíz sin hijas) → no se muestra la sección', () => {
    renderEditor([pProd, pServ]);
    fireEvent.click(screen.getByTestId('add-attribute-btn'));
    expect(screen.queryByTestId('children-impact')).not.toBeInTheDocument();
  });

  it('con una hija → muestra su impacto ANTES de tocar nada (refleja lo ya guardado del padre)', () => {
    renderEditor([pProd, pServ], [cochesChild]);
    fireEvent.click(screen.getByTestId('add-attribute-btn'));

    expect(screen.getByTestId('children-impact')).toBeInTheDocument();
    const line = screen.getByTestId('child-impact-Coches').textContent;
    // Coches efectivo: cProd (propio, Producto) + pProd (heredado, Producto) + pServ (heredado, Servicio)
    expect(line).toContain('Coches');
    expect(line).toContain('Producto 2/2');
    expect(line).toContain('Servicio 1/2');
  });

  it('el impacto se recalcula EN VIVO al marcar cardAttribute en el nuevo atributo del padre (antes de guardar)', () => {
    renderEditor([pProd, pServ], [cochesChild]);
    fireEvent.click(screen.getByTestId('add-attribute-btn'));

    // Nuevo atributo del padre, solo SERVICIO, marcado cardAttribute.
    fireEvent.click(screen.getByTestId('applies-to-product-checkbox')); // deja solo Servicio
    fireEvent.change(screen.getByTestId('attr-name-input'), { target: { value: 'pServ2' } });
    fireEvent.change(screen.getByTestId('attr-label-input'), { target: { value: 'Padre Servicio 2' } });
    fireEvent.click(screen.getByTestId('card-attribute-checkbox'));

    const line = screen.getByTestId('child-impact-Coches').textContent;
    // Servicio en Coches pasa de 1/2 a 2/2 (pServ + pServ2 heredados); Producto sigue 2/2.
    expect(line).toContain('Producto 2/2');
    expect(line).toContain('Servicio 2/2');
  });

  it('EXCEDER el tope de una hija → marca ⚠ (aviso visual, antes de guardar)', () => {
    renderEditor([pProd, pServ], [cochesChild]);
    fireEvent.click(screen.getByTestId('add-attribute-btn'));

    // Nuevo atributo del padre, PRODUCTO — Coches ya tiene 2/2 de Producto (cProd+pProd),
    // así que esto lo dejaría en 3/2.
    fireEvent.change(screen.getByTestId('attr-name-input'), { target: { value: 'pProd2' } });
    fireEvent.change(screen.getByTestId('attr-label-input'), { target: { value: 'Padre Producto 2' } });
    fireEvent.click(screen.getByTestId('applies-to-service-checkbox')); // deja solo Producto
    fireEvent.click(screen.getByTestId('card-attribute-checkbox'));

    const line = screen.getByTestId('child-impact-Coches');
    expect(line.textContent).toContain('⚠');
    expect(line.textContent).toContain('Producto 3/2');
  });

  it('varias hijas se muestran cada una con su propio impacto', () => {
    renderEditor([pProd, pServ], [cochesChild, motosChild]);
    fireEvent.click(screen.getByTestId('add-attribute-btn'));

    expect(screen.getByTestId('child-impact-Coches')).toBeInTheDocument();
    expect(screen.getByTestId('child-impact-Motos')).toBeInTheDocument();
    // Motos no tiene atributos propios: efectivo = solo lo heredado (1 Producto, 1 Servicio).
    const motosLine = screen.getByTestId('child-impact-Motos').textContent;
    expect(motosLine).toContain('Producto 1/2');
    expect(motosLine).toContain('Servicio 1/2');
  });

  it('el impacto de "card ampliada" (wideCardAttribute) se calcula independiente del estándar', () => {
    const childWithWide = {
      name: 'Coches',
      attributeSchema: [
        { name: 'cWide1', label: 'W1', type: 'text' as const, filterable: false, required: false, cardAttribute: false, wideCardAttribute: true, appliesTo: ['PRODUCT' as const] },
      ],
    };
    renderEditor([pProd], [childWithWide]);
    fireEvent.click(screen.getByTestId('add-attribute-btn'));

    fireEvent.change(screen.getByTestId('attr-name-input'), { target: { value: 'pWide' } });
    fireEvent.change(screen.getByTestId('attr-label-input'), { target: { value: 'Padre Wide' } });
    fireEvent.click(screen.getByTestId('applies-to-service-checkbox')); // deja solo Producto
    fireEvent.click(screen.getByTestId('wide-card-attribute-checkbox'));

    const line = screen.getByTestId('child-impact-Coches').textContent;
    // Card estándar: solo pProd heredado (Producto 1/2). Ampliada: cWide1 + pWide (Producto 2/6).
    expect(line).toContain('Producto 1/2');
    expect(line).toContain('Ampliada: Producto 2/6');
  });
});
