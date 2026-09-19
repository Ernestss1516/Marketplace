import { render, screen } from '@testing-library/react';
import { FeaturedBlock } from './FeaturedBlock';
import {
  COLUMNAS_POR_TRAMO,
  MAXIMO_VISIBLE,
  VISIBLES_POR_TRAMO,
  claseDeRevelado,
} from './destacados-dos-filas';
import type { ListingSummary } from '@/types';

jest.mock('@/components/anuncios/ListingCard', () => ({
  ListingCard: ({ listing }: { listing: { id: string; title: string } }) => (
    <article data-testid="tarjeta">{listing.title}</article>
  ),
}));

/**
 * LAS DOS FILAS — que el bloque enseñe lo que cabe, y NADA MÁS QUE LO QUE HAY.
 *
 * Lo que se fija aquí es la mitad de la honestidad del bloque: el número que se ve es
 * `min(destacados que existen, lo que cabe en dos filas)`. La otra mitad —que lo servido sean
 * destacados de verdad y no los ocho primeros resultados— la sostiene la consulta del anillo
 * (`onlyBoosted`), y se prueba en la API.
 */
const anuncio = (i: number): ListingSummary =>
  ({ id: `d${i}`, title: `Destacado ${i}`, slug: `d${i}` }) as unknown as ListingSummary;

const lista = (n: number) => Array.from({ length: n }, (_, i) => anuncio(i));

describe('la tabla de dos filas', () => {
  it('sale de las columnas de la rejilla: 2/3/4 → 4/6/8', () => {
    expect(VISIBLES_POR_TRAMO.base).toBe(COLUMNAS_POR_TRAMO.base * 2);
    expect(VISIBLES_POR_TRAMO.sm).toBe(COLUMNAS_POR_TRAMO.sm * 2);
    expect(VISIBLES_POR_TRAMO.md).toBe(COLUMNAS_POR_TRAMO.md * 2);
    expect([VISIBLES_POR_TRAMO.base, VISIBLES_POR_TRAMO.sm, VISIBLES_POR_TRAMO.md]).toEqual([
      4, 6, 8,
    ]);
  });

  it('LA BARRERA DE LAS DOS COPIAS — la tabla y las clases de la rejilla dicen lo mismo', () => {
    /**
     * Tailwind necesita las clases escritas literalmente, así que las columnas viven en el
     * JSX y la tabla en el módulo: dos sitios para un mismo número. Este caso los compara.
     * Sin él, cambiar `md:grid-cols-4` por `md:grid-cols-5` dejaría el bloque enseñando ocho
     * en una rejilla de cinco —o sea, fila y media— y nadie se enteraría.
     */
    const { container } = render(<FeaturedBlock listings={lista(1)} />);
    const rejilla = container.querySelector('.grid')!;

    expect(rejilla.className).toContain(`grid-cols-${COLUMNAS_POR_TRAMO.base}`);
    expect(rejilla.className).toContain(`sm:grid-cols-${COLUMNAS_POR_TRAMO.sm}`);
    expect(rejilla.className).toContain(`md:grid-cols-${COLUMNAS_POR_TRAMO.md}`);
  });

  it('el recorte va por ÍNDICE: las cuatro primeras siempre, luego por tramo', () => {
    expect([0, 1, 2, 3].map(claseDeRevelado)).toEqual(['', '', '', '']);
    expect([4, 5].map(claseDeRevelado)).toEqual(['hidden sm:block', 'hidden sm:block']);
    expect([6, 7].map(claseDeRevelado)).toEqual(['hidden md:block', 'hidden md:block']);
    // Por encima del máximo no debería llegar nada —el servidor recorta—, pero una tarjeta
    // colándose en una tercera fila es justo lo que este bloque no puede hacer.
    expect(claseDeRevelado(MAXIMO_VISIBLE)).toBe('hidden');
  });
});

describe('NUNCA RELLENA — la sección ocupa lo justo', () => {
  it('sin destacados no hay sección', () => {
    const { container } = render(<FeaturedBlock listings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('con TRES destacados se pintan tres, no ocho huecos', () => {
    render(<FeaturedBlock listings={lista(3)} />);
    expect(screen.getAllByTestId('tarjeta')).toHaveLength(3);
  });

  it('con CINCO se pintan CINCO — la fila a medias se enseña (D-1)', () => {
    /**
     * «Dos filas» es el TOPE, no la obligación de llenarlas. Con cinco destacados y cuatro
     * columnas queda una fila llena y otra con uno, y se enseña: recortar a cuatro para que la
     * rejilla quedara cuadrada sería esconder a un vendedor que ha pagado, por estética.
     */
    render(<FeaturedBlock listings={lista(5)} />);
    expect(screen.getAllByTestId('tarjeta')).toHaveLength(5);
  });

  it('con OCHO se pintan ocho, y la quinta en adelante llevan su recorte por tramo', () => {
    const { container } = render(<FeaturedBlock listings={lista(8)} />);
    expect(screen.getAllByTestId('tarjeta')).toHaveLength(8);

    // Las cuatro primeras se ven en cualquier ancho: sin envoltorio y sin clase de recorte.
    expect(container.querySelectorAll('.hidden.sm\\:block')).toHaveLength(2);
    expect(container.querySelectorAll('.hidden.md\\:block')).toHaveLength(2);
  });

  it('EL RECORTE ES CSS, NO JAVASCRIPT — las ocho están en el HTML desde el servidor', () => {
    // Es lo que hace que no haya salto: el marcado nace correcto y el navegador sólo decide
    // cuáles pinta. Si alguien lo cambiara por un recorte en cliente, este caso vería menos
    // de ocho tarjetas en el render inicial.
    render(<FeaturedBlock listings={lista(8)} />);
    expect(screen.getAllByTestId('tarjeta')).toHaveLength(8);
  });
});
