// FLECO — el ratio de me gusta, con el tratamiento de muestra pequeña del CTR.
//
// La barrera concreta: que el panel NO vuelva a decir «un 100% de quienes lo ven lo
// guardan» cuando el anuncio tiene una visita.

import { render, screen } from '@testing-library/react';
import { LikeRatioLine } from './LikeRatioLine';
import { CtrLine } from './CtrLine';

describe('LikeRatioLine', () => {
  it('LA MUTACIÓN: 1 me gusta sobre 1 visita no pinta «100%», dice cuántas faltan', () => {
    render(
      <LikeRatioLine likeRatio={{ value: null, favorites: 1, views: 1, minViews: 30 }} />,
    );

    expect(screen.queryByText(/100/)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByTestId('stats-like-ratio-insufficient')).toHaveTextContent(
      /al menos\s*30\s*y llevas\s*1/,
    );
  });

  it('con visitas suficientes enseña el porcentaje y los conteos', () => {
    render(
      <LikeRatioLine likeRatio={{ value: 0.1, favorites: 4, views: 40, minViews: 30 }} />,
    );

    const linea = screen.getByTestId('stats-like-ratio-value');
    expect(linea).toHaveTextContent('10 %');
    expect(linea).toHaveTextContent('4 me gusta sobre 40 visitas');
  });

  it('«1 me gusta» no se pluraliza en «1 me gustas»', () => {
    render(
      <LikeRatioLine likeRatio={{ value: 0.025, favorites: 1, views: 40, minViews: 30 }} />,
    );

    expect(screen.getByTestId('stats-like-ratio-value')).toHaveTextContent(
      '1 me gusta sobre 40 visitas',
    );
  });

  it('sin ratio (un no-Pro, que no lo recibe) no pinta nada', () => {
    const { container } = render(<LikeRatioLine likeRatio={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('los dos ratios comparten el tratamiento, no una redacción parecida', () => {
  it('con muestra pequeña, los dos dicen lo mismo salvo el sustantivo y el umbral', () => {
    // El requisito de oro del fleco. Si alguien reimplantara el tratamiento en uno de los
    // dos, esta comparación empezaría a fallar en cuanto las frases se separaran.
    const { container: conCtr } = render(
      <CtrLine ctr={{ value: null, views: 2, impressions: 3, minImpressions: 100 }} />,
    );
    const textoCtr = conCtr.textContent ?? '';

    const { container: conLike } = render(
      <LikeRatioLine likeRatio={{ value: null, favorites: 2, views: 3, minViews: 30 }} />,
    );
    const textoLike = conLike.textContent ?? '';

    for (const frase of ['Todavía no se puede calcular', 'engaña más que informa', 'Hacen falta al menos']) {
      expect(textoCtr).toContain(frase);
      expect(textoLike).toContain(frase);
    }
    // Y lo que SÍ cambia: el sustantivo de la muestra y el umbral.
    expect(textoCtr).toContain('apariciones');
    expect(textoLike).toContain('visitas');
    expect(textoCtr).toContain('100');
    expect(textoLike).toContain('30');
  });
});
