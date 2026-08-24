// ESTADÍSTICAS A2 — la fusión de series, que es donde la gráfica de dos líneas se puede
// equivocar en silencio.
//
// Se prueba `mergeSeries` y NO el SVG: recharts se dibuja dentro de un
// `ResponsiveContainer`, que en jsdom mide 0×0 y no pinta nada. Un test sobre el SVG
// pasaría sin comprobar nada real. La regla que importa —rellenar los huecos con 0— es
// pura y se comprueba entera aquí.

import { render, screen } from '@testing-library/react';
import { mergeSeries, StatsChart, STATS_COLORS } from './StatsChart';

const serie = (key: string, data: Array<[string, number]>) => ({
  key,
  label: key,
  color: '#000',
  data: data.map(([date, count]) => ({ date, count })),
});

describe('mergeSeries — dos series diarias en una sola tabla', () => {
  it('LA MUTACIÓN: un día que solo tiene una serie NO deja a la otra sin punto', () => {
    // Sin el relleno, la línea de apariciones no tendría punto el día 21 y recharts
    // dibujaría un segmento recto por encima del hueco — que se lee como «ese día hubo
    // apariciones intermedias». Un 0 es un hecho; un hueco es una mentira interpolada.
    const filas = mergeSeries([
      serie('views', [['2026-08-20', 3], ['2026-08-21', 5]]),
      serie('impressions', [['2026-08-20', 40]]),
    ]);

    expect(filas).toEqual([
      { date: '2026-08-20', views: 3, impressions: 40 },
      { date: '2026-08-21', views: 5, impressions: 0 },
    ]);
  });

  it('ordena por fecha aunque las series lleguen desordenadas o desalineadas', () => {
    const filas = mergeSeries([
      serie('views', [['2026-08-22', 1]]),
      serie('impressions', [['2026-08-20', 9], ['2026-08-21', 7]]),
    ]);

    expect(filas.map((f) => f.date)).toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
    expect(filas[0]).toEqual({ date: '2026-08-20', views: 0, impressions: 9 });
  });

  it('una serie vacía no borra a la otra: pinta ceros, no nada', () => {
    const filas = mergeSeries([
      serie('views', [['2026-08-20', 3]]),
      serie('impressions', []),
    ]);

    expect(filas).toEqual([{ date: '2026-08-20', views: 3, impressions: 0 }]);
  });

  it('sin ningún punto en ninguna serie no hay filas (y la gráfica dirá que no hay datos)', () => {
    expect(mergeSeries([serie('views', []), serie('impressions', [])])).toEqual([]);
  });

  it('no fusiona por índice sino por FECHA: dos series con días distintos no se solapan', () => {
    const filas = mergeSeries([
      serie('views', [['2026-08-20', 1]]),
      serie('impressions', [['2026-08-21', 2]]),
    ]);

    expect(filas).toEqual([
      { date: '2026-08-20', views: 1, impressions: 0 },
      { date: '2026-08-21', views: 0, impressions: 2 },
    ]);
  });
});

describe('StatsChart', () => {
  it('sin datos enseña el mensaje de vacío, no una gráfica en blanco', () => {
    render(
      <StatsChart
        title="Visitas y veces listado, por día"
        emptyMessage="Aún no hay datos suficientes para este anuncio."
        series={[serie('views', []), serie('impressions', [])]}
      />,
    );

    expect(screen.getByText('Aún no hay datos suficientes para este anuncio.')).toBeInTheDocument();
  });

  it('los dos colores del par salen de un solo sitio, para que A2 y B1 no diverjan', () => {
    expect(STATS_COLORS.views).not.toBe(STATS_COLORS.impressions);
  });
});
