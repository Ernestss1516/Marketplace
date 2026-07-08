// NUEVA FEATURE — selects vinculados (Marca/Modelo): reactividad en el
// wizard. B (dependsOn: A) recalcula sus opciones cuando A cambia, se
// resetea si el valor ya no es válido, y permanece deshabilitado hasta que
// A tenga valor.
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { StepAtributos } from './StepAtributos';
import type { AttributeSchema } from '@/types';

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
});

const brand: AttributeSchema = {
  name: 'brand', label: 'Marca', type: 'select', filterable: true, required: false,
  options: ['Seat', 'BMW'],
};
const model: AttributeSchema = {
  name: 'model', label: 'Modelo', type: 'select', filterable: true, required: false,
  dependsOn: 'brand',
  // "Básico" se repite en ambas marcas a propósito — permite probar que un
  // valor de Modelo que SIGUE siendo válido tras cambiar de Marca no se resetea.
  optionsByParent: { Seat: ['Ibiza', 'León', 'Básico'], BMW: ['Serie 1', 'Serie 3', 'Básico'] },
};

// Wrapper con estado real — StepAtributos es controlado; sin un padre que
// reinyecte `values` tras onChange, el "reset" y el recálculo de opciones
// nunca se reflejarían en el siguiente render (igual que en PublicarWizard).
function StatefulHarness({
  initial,
  onChangeSpy,
}: {
  initial: Record<string, string>;
  onChangeSpy: (v: Record<string, string>) => void;
}) {
  const [values, setValues] = useState(initial);
  return (
    <StepAtributos
      schema={[brand, model]}
      values={values}
      onChange={(v) => { onChangeSpy(v); setValues(v); }}
      errors={{}}
    />
  );
}

function renderStep(values: Record<string, string> = {}) {
  const onChange = jest.fn();
  const utils = render(<StatefulHarness initial={values} onChangeSpy={onChange} />);
  return { onChange, ...utils };
}

describe('StepAtributos — selects vinculados (Marca/Modelo)', () => {
  it('el campo dependiente (Modelo) está deshabilitado hasta que el padre (Marca) tenga valor', () => {
    renderStep();
    expect(screen.getByLabelText('Modelo')).toBeDisabled();
  });

  it('al elegir Marca, Modelo se habilita y muestra solo las opciones de esa marca', () => {
    renderStep();
    fireEvent.click(screen.getByLabelText('Marca'));
    fireEvent.click(screen.getByRole('option', { name: 'Seat' }));

    expect(screen.getByLabelText('Modelo')).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText('Modelo'));
    expect(screen.getByRole('option', { name: 'Ibiza' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'León' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Serie 1' })).not.toBeInTheDocument();
  });

  it('cambiar Marca a un valor que invalida el Modelo ya elegido resetea Modelo', () => {
    const { onChange } = renderStep({ brand: 'Seat', model: 'Ibiza' });

    fireEvent.click(screen.getByLabelText('Marca'));
    fireEvent.click(screen.getByRole('option', { name: 'BMW' }));

    expect(onChange).toHaveBeenCalledWith({ brand: 'BMW', model: '' });
  });

  it('cambiar Marca a un valor que SÍ admite el Modelo ya elegido no lo resetea', () => {
    const { onChange } = renderStep({ brand: 'Seat', model: 'Básico' });

    fireEvent.click(screen.getByLabelText('Marca'));
    fireEvent.click(screen.getByRole('option', { name: 'BMW' }));

    // "Básico" también es válido para BMW — no se resetea al cambiar de marca.
    expect(onChange).toHaveBeenCalledWith({ brand: 'BMW', model: 'Básico' });
  });
});
