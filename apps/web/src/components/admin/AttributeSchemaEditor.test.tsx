// Fase 5.2 (cierre) — FIX 2: aviso al renombrar la key de un atributo con datos
// existentes. No usamos @testing-library/user-event (no está entre las
// devDependencies del workspace); fireEvent + act cubren los mismos casos.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AttributeSchemaEditor, type AttributeSchemaWithExtras } from './AttributeSchemaEditor';

const fuelField: AttributeSchemaWithExtras = {
  name: 'fuel',
  label: 'Combustible',
  type: 'text',
  filterable: true,
  required: false,
};

function renderEditor(checkAttributeUsage?: (oldKey: string) => Promise<number>) {
  const onChange = jest.fn();
  render(
    <AttributeSchemaEditor
      ownSchema={[fuelField]}
      inheritedFields={[]}
      searchableKeys={['fuel', 'brand']}
      onChange={onChange}
      checkAttributeUsage={checkAttributeUsage}
    />,
  );
  return { onChange };
}

function renameFuelTo(newName: string) {
  fireEvent.click(screen.getByTestId('edit-attr-fuel'));
  fireEvent.change(screen.getByTestId('attr-name-input'), { target: { value: newName } });
}

describe('AttributeSchemaEditor — aviso al renombrar una key con datos', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renombrar una key EXISTENTE con datos (count > 0) muestra confirm() con el count real', async () => {
    const checkAttributeUsage = jest.fn().mockResolvedValue(3);
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const { onChange } = renderEditor(checkAttributeUsage);

    renameFuelTo('combustible');
    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    await waitFor(() => expect(checkAttributeUsage).toHaveBeenCalledWith('fuel'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const message = confirmSpy.mock.calls[0][0] as string;
    expect(message).toContain('3 anuncio(s)');
    expect(message).toContain("'fuel'");
    expect(message).toContain("'combustible'");

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'combustible' })]);
  });

  it('cancelar el confirm() aborta el renombrado (no llama a onChange)', async () => {
    const checkAttributeUsage = jest.fn().mockResolvedValue(2);
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    const { onChange } = renderEditor(checkAttributeUsage);

    renameFuelTo('combustible');
    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    await waitFor(() => expect(checkAttributeUsage).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
    // El formulario de edición sigue abierto con el nombre tecleado.
    expect(screen.getByTestId('attr-name-input')).toHaveValue('combustible');
  });

  it('renombrar una key SIN datos (count 0) no muestra confirm()', async () => {
    const checkAttributeUsage = jest.fn().mockResolvedValue(0);
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const { onChange } = renderEditor(checkAttributeUsage);

    renameFuelTo('combustible');
    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    await waitFor(() => expect(checkAttributeUsage).toHaveBeenCalledWith('fuel'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ name: 'combustible' })]);
  });

  it('crear un atributo NUEVO no dispara checkAttributeUsage ni confirm()', async () => {
    const checkAttributeUsage = jest.fn().mockResolvedValue(5);
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const { onChange } = renderEditor(checkAttributeUsage);

    fireEvent.click(screen.getByTestId('add-attribute-btn'));
    fireEvent.change(screen.getByTestId('attr-name-input'), { target: { value: 'color' } });
    fireEvent.change(screen.getByTestId('attr-label-input'), { target: { value: 'Color' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(checkAttributeUsage).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('editar una fila SIN cambiar el name no dispara checkAttributeUsage', async () => {
    const checkAttributeUsage = jest.fn().mockResolvedValue(5);
    const { onChange } = renderEditor(checkAttributeUsage);

    fireEvent.click(screen.getByTestId('edit-attr-fuel'));
    fireEvent.change(screen.getByTestId('attr-label-input'), { target: { value: 'Combustible (editado)' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('attr-confirm-btn'));
    });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(checkAttributeUsage).not.toHaveBeenCalled();
  });
});
