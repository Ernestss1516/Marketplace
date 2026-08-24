// ESTADÍSTICAS A2 — cómo se cuenta el CTR. La barrera concreta: que el vendedor NUNCA
// lea un porcentaje rotundo construido sobre tres apariciones.

import { render, screen } from '@testing-library/react';
import { CtrLine } from './CtrLine';

describe('CtrLine', () => {
  it('LA MUTACIÓN: con pocas apariciones no hay porcentaje, hay cuántas faltan', () => {
    // Sin umbral esto pintaría «67%». El test comprueba las dos mitades: que el número
    // engañoso NO está, y que en su lugar se dice algo útil.
    render(<CtrLine ctr={{ value: null, views: 2, impressions: 3, minImpressions: 100 }} />);

    expect(screen.queryByText(/67/)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByTestId('stats-ctr-insufficient')).toHaveTextContent(
      /al menos\s*100\s*y llevas\s*3/,
    );
  });

  it('con muestra suficiente enseña el porcentaje y los conteos que lo sostienen', () => {
    render(<CtrLine ctr={{ value: 0.05, views: 10, impressions: 200, minImpressions: 100 }} />);

    const linea = screen.getByTestId('stats-ctr-value');
    expect(linea).toHaveTextContent('5 %');
    // Los conteos van al lado a propósito: el vendedor puede juzgar el número por sí mismo.
    expect(linea).toHaveTextContent('10 visitas sobre 200 apariciones');
  });

  it('un CTR pequeño no se redondea a 0 %', () => {
    // `Math.round(value * 100)` habría dado «0 %» y el vendedor leería que no entra nadie.
    render(<CtrLine ctr={{ value: 0.004, views: 2, impressions: 500, minImpressions: 100 }} />);

    expect(screen.getByTestId('stats-ctr-value')).toHaveTextContent('0,4 %');
  });

  it('más visitas que apariciones se EXPLICA, no se recorta a 100 %', () => {
    render(<CtrLine ctr={{ value: 3, views: 300, impressions: 100, minImpressions: 100 }} />);

    const linea = screen.getByTestId('stats-ctr-value');
    expect(linea).toHaveTextContent('más visitas que apariciones');
    expect(linea).toHaveTextContent(/enlace directo|favoritos|perfil/);
    expect(linea).not.toHaveTextContent('300 %');
  });

  it('un 0 % con apariciones de sobra SÍ se enseña: «sales y no entra nadie» es el diagnóstico', () => {
    render(<CtrLine ctr={{ value: 0, views: 0, impressions: 800, minImpressions: 100 }} />);

    expect(screen.getByTestId('stats-ctr-value')).toHaveTextContent('0 %');
  });

  it('sin CTR (un no-Pro, que no lo recibe) no pinta nada', () => {
    const { container } = render(<CtrLine ctr={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('singulares y plurales, para que no salga «1 visitas sobre 1 apariciones»', () => {
    render(<CtrLine ctr={{ value: null, views: 1, impressions: 1, minImpressions: 100 }} />);

    expect(screen.getByTestId('stats-ctr-insufficient')).toBeInTheDocument();
  });
});
