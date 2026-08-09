/**
 * UXV.6 (M9) — el historial se pasea.
 *
 * Se prueba AQUÍ y no en Playwright por una razón de arquitectura, no de comodidad:
 * `/mis-creditos` es un Server Component y su PRIMERA página la sirve el servidor, así que
 * `page.route` no puede fabricar un historial de tres páginas para el render inicial (la
 * cabecera de `e2e/mis-creditos.spec.ts` ya documenta esa limitación). El componente, en
 * cambio, recibe la página inicial por props y la función de carga inyectada: aquí sí se
 * controla todo, incluido el caso de que la carga falle.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HistorialPaginado } from './HistorialPaginado';

interface Mov {
  id: string;
  label: string;
}

const pagina = (n: number, totalPages: number) => ({
  items: [{ id: `m${n}`, label: `Movimiento de la página ${n}` }],
  total: totalPages,
  page: n,
  perPage: 1,
  totalPages,
});

function renderHistorial(totalPages: number, cargar = jest.fn()) {
  const load = cargar.mockImplementation((n: number) => Promise.resolve(pagina(n, totalPages)));
  render(
    <HistorialPaginado<Mov>
      inicial={pagina(1, totalPages)}
      cargar={load}
      clave={(i) => i.id}
      fila={(i) => <span>{i.label}</span>}
      vacio={<p>Sin movimientos todavía.</p>}
    />,
  );
  return load;
}

describe('HistorialPaginado', () => {
  it('con varias páginas muestra los controles y navega hacia delante', async () => {
    renderHistorial(3);

    expect(screen.getByText(/página 1 de 3/i)).toBeInTheDocument();
    expect(screen.getByText('Movimiento de la página 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));

    await waitFor(() => expect(screen.getByText(/página 2 de 3/i)).toBeInTheDocument());
    expect(screen.getByText('Movimiento de la página 2')).toBeInTheDocument();
  });

  it('y hacia atrás', async () => {
    renderHistorial(3);

    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
    await waitFor(() => expect(screen.getByText(/página 2 de 3/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Página anterior' }));
    await waitFor(() => expect(screen.getByText(/página 1 de 3/i)).toBeInTheDocument());
  });

  it('en los extremos, el botón que no lleva a ninguna parte está deshabilitado', async () => {
    renderHistorial(2);

    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Página siguiente' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
    await waitFor(() => expect(screen.getByText(/página 2 de 2/i)).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Página siguiente' })).toBeDisabled();
  });

  it('con UNA sola página no pinta controles: serían dos botones muertos', () => {
    renderHistorial(1);

    expect(screen.queryByRole('button', { name: 'Página siguiente' })).not.toBeInTheDocument();
    expect(screen.queryByText(/página 1 de/i)).not.toBeInTheDocument();
  });

  it('sin movimientos enseña el estado vacío que le pasan (B5)', () => {
    render(
      <HistorialPaginado<Mov>
        inicial={{ items: [], total: 0, page: 1, perPage: 20, totalPages: 0 }}
        cargar={jest.fn()}
        clave={(i) => i.id}
        fila={(i) => <span>{i.label}</span>}
        vacio={<p>Sin movimientos todavía.</p>}
      />,
    );

    expect(screen.getByText('Sin movimientos todavía.')).toBeInTheDocument();
  });

  it('si la carga falla, NO se vacía lo que el usuario está mirando', async () => {
    const cargar = jest.fn().mockRejectedValue(new Error('red caída'));
    render(
      <HistorialPaginado<Mov>
        inicial={pagina(1, 3)}
        cargar={cargar}
        clave={(i) => i.id}
        fila={(i) => <span>{i.label}</span>}
        vacio={<p>Sin movimientos todavía.</p>}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));

    await waitFor(() => expect(cargar).toHaveBeenCalled());
    // Se queda donde estaba, con sus datos: perder la lista por un fallo de red sería peor
    // que no pasar de página.
    expect(screen.getByText('Movimiento de la página 1')).toBeInTheDocument();
    expect(screen.getByText(/página 1 de 3/i)).toBeInTheDocument();
  });
});
