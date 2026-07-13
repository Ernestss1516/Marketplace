// RÁFAGA 3 (display de atributos en card) — las 4 combinaciones de
// showLabel/showUnit, en card estándar (CardAttrsDisplay) y ampliada
// (WideCardAttrsDisplay). Reemplaza la regla hardcodeada "oculta el label si
// hay unidad" por los dos flags configurables por atributo.
import { render, screen } from '@testing-library/react';
import {
  CardAttributesProvider,
  CardAttrsDisplay,
  WideCardAttributesProvider,
  WideCardAttrsDisplay,
} from './CardAttributesContext';
import type { CardAttributeDef } from '@/types';

function renderCard(def: CardAttributeDef, attributes: Record<string, unknown>) {
  render(
    <CardAttributesProvider cardAttributeMap={{ coches: [def] }}>
      <CardAttrsDisplay categorySlug="coches" attributes={attributes} />
    </CardAttributesProvider>,
  );
}

function renderWideCard(def: CardAttributeDef, attributes: Record<string, unknown>) {
  render(
    <WideCardAttributesProvider cardAttributeMap={{ coches: [def] }}>
      <WideCardAttrsDisplay categorySlug="coches" attributes={attributes} />
    </WideCardAttributesProvider>,
  );
}

describe('CardAttrsDisplay — las 4 combinaciones (card estándar)', () => {
  it('showLabel:true, showUnit:true → "Kilometraje: 150000 km"', () => {
    renderCard({ key: 'km', label: 'Kilometraje', unit: 'km', showLabel: true, showUnit: true }, { km: 150000 });
    expect(screen.getByText('Kilometraje: 150000 km')).toBeInTheDocument();
  });

  it('showLabel:false, showUnit:true → "150000 km" (caso 3 pedido)', () => {
    renderCard({ key: 'km', label: 'Kilometraje', unit: 'km', showLabel: false, showUnit: true }, { km: 150000 });
    expect(screen.getByText('150000 km')).toBeInTheDocument();
  });

  it('showLabel:true, showUnit:false → "Habitaciones: 3" (caso 1 pedido)', () => {
    renderCard({ key: 'rooms', label: 'Habitaciones', showLabel: true, showUnit: false }, { rooms: 3 });
    expect(screen.getByText('Habitaciones: 3')).toBeInTheDocument();
  });

  it('showLabel:false, showUnit:false → "3" (caso 2 pedido)', () => {
    renderCard({ key: 'rooms', label: 'Habitaciones', showLabel: false, showUnit: false }, { rooms: 3 });
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('atributo SIN unidad con showUnit:true → no rompe, simplemente no hay unidad que mostrar', () => {
    renderCard({ key: 'rooms', label: 'Habitaciones', showLabel: true, showUnit: true }, { rooms: 3 });
    expect(screen.getByText('Habitaciones: 3')).toBeInTheDocument();
  });

  it('valor ausente → no renderiza nada', () => {
    const { container } = render(
      <CardAttributesProvider cardAttributeMap={{ coches: [{ key: 'km', label: 'Kilometraje', unit: 'km', showLabel: false, showUnit: true }] }}>
        <CardAttrsDisplay categorySlug="coches" attributes={{}} />
      </CardAttributesProvider>,
    );
    expect(container.textContent).toBe('');
  });
});

describe('WideCardAttrsDisplay — las 4 combinaciones (vista ampliada)', () => {
  it('showLabel:true, showUnit:true → label + "150000 km"', () => {
    renderWideCard({ key: 'km', label: 'Kilometraje', unit: 'km', showLabel: true, showUnit: true }, { km: 150000 });
    expect(screen.getByText('Kilometraje:')).toBeInTheDocument();
    expect(screen.getByText('150000 km')).toBeInTheDocument();
  });

  it('showLabel:false, showUnit:true → sin label, "150000 km"', () => {
    renderWideCard({ key: 'km', label: 'Kilometraje', unit: 'km', showLabel: false, showUnit: true }, { km: 150000 });
    expect(screen.queryByText('Kilometraje:')).not.toBeInTheDocument();
    expect(screen.getByText('150000 km')).toBeInTheDocument();
  });

  it('showLabel:true, showUnit:false → label + "3" (sin unidad)', () => {
    renderWideCard({ key: 'rooms', label: 'Habitaciones', unit: 'hab', showLabel: true, showUnit: false }, { rooms: 3 });
    expect(screen.getByText('Habitaciones:')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('showLabel:false, showUnit:false → solo "3"', () => {
    renderWideCard({ key: 'rooms', label: 'Habitaciones', unit: 'hab', showLabel: false, showUnit: false }, { rooms: 3 });
    expect(screen.queryByText('Habitaciones:')).not.toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('atributo SIN unidad con showUnit:true → no rompe', () => {
    renderWideCard({ key: 'rooms', label: 'Habitaciones', showLabel: true, showUnit: true }, { rooms: 3 });
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
