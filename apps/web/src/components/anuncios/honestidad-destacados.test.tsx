/**
 * ROTACIÓN DE DESTACADOS — R3: LA HONESTIDAD.
 *
 * Las tres correcciones para que lo que se promete sea lo que se entrega, ahora que R2 hace
 * cierto lo que antes era falso. Ver docs/diseno-rotacion-destacados.md §10.
 *
 *  · 10.1 LA FRASE del diálogo de compra: promete un TURNO, no permanencia.
 *  · 10.2 «Destacados primero» → «Recientes o reimpulsados» (el VALOR guardado no se toca).
 *  · 10.3 LA ETIQUETA en el mapa, con un único `FeaturedBadge` para las cuatro superficies.
 *
 * LAS MUTACIONES QUE ESTO MATA:
 *  · volver a prometer permanencia («aparece … durante varios días») → la frase mentiría otra
 *    vez para quien destaca en una categoría con muchos destacados;
 *  · renombrar el valor 'featured' → los bloques ya publicados dejarían de resolver su orden;
 *  · pintar la etiqueta sin `compact` en la miniatura de 56 px → se saldría;
 *  · duplicar el marcado del badge en vez de usar el componente → cuatro copias que divergen.
 */

import { render, screen } from '@testing-library/react';
import { FeaturedBadge } from './FeaturedBadge';
import { ListingCard } from './ListingCard';
import { ListingCardWide } from './ListingCardWide';
import { FloatingCard, SelectedListingPanel } from '@/components/busqueda/MapCards';
import type { ListingSummary } from '@/types';

// Los mismos tres mocks que ya usa BlockRenderer.test.tsx para poder pintar una ListingCard
// real, y por los mismos motivos: `next-auth/react` es ESM-only y next/jest no lo transforma;
// `FavoriteCardButton` llama a `useRequireAuth()` incondicionalmente (regla de hooks) y de ahí
// a `useRouter()`, que en jsdom no tiene AppRouterContext; y `prefetch` no es un atributo DOM.
jest.mock('next/link', () => {
  return function MockLink({
    href,
    children,
    prefetch: _prefetch,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    prefetch?: boolean;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: null }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
}));

function anuncio(overrides: Partial<ListingSummary> = {}): ListingSummary {
  return {
    id: 'l1',
    title: 'Coche gris',
    slug: 'coche-gris',
    price: 1000,
    currency: 'EUR',
    priceType: 'FIXED',
    status: 'ACTIVE',
    thumbnailUrl: 'https://cdn.test/foto.jpg',
    province: 'Madrid',
    city: 'Madrid',
    categorySlug: 'coches',
    hasVideo: false,
    ...overrides,
  } as ListingSummary;
}

describe('R3 §10.3 — UNA sola etiqueta «Destacado» para las cuatro superficies', () => {
  it('la completa dice la palabra; la compacta no, pero la sigue diciendo a un lector', () => {
    // Mismo componente y mismo `data-testid`: lo que cambia es cuánto ocupa, no qué dice —
    // el mismo criterio que ya se aplicó al indicador de vídeo.
    const { unmount } = render(<FeaturedBadge />);
    expect(screen.getByTestId('card-destacado')).toHaveTextContent('Destacado');
    unmount();

    render(<FeaturedBadge compact />);
    const compacta = screen.getByTestId('card-destacado');
    expect(compacta).toHaveTextContent(''); // sin palabra: no cabe en 56 px
    expect(compacta).toHaveAttribute('aria-label', 'Destacado'); // pero no desaparece
    expect(compacta).toHaveAttribute('role', 'img');
  });

  it('no le roba el clic a la tarjeta, que entera es un enlace al anuncio', () => {
    render(<FeaturedBadge />);
    expect(screen.getByTestId('card-destacado').className).toContain('pointer-events-none');
  });

  it('LAS CUATRO superficies pintan LA MISMA etiqueta cuando boostScore es 1', () => {
    // LA BARRERA DEL COMPONENTE ÚNICO. Las dos del mapa NO la tenían: recibían el
    // `boostScore` y no lo pintaban, igual que en su día se quedaron sin indicador de vídeo.
    // Si alguien vuelve a escribir el `<Badge>` a mano en cualquiera de las cuatro, el
    // `data-testid` dejará de coincidir ahí y este test lo dirá.
    const destacado = anuncio({ boostScore: 1 });
    const superficies: Record<string, React.ReactElement> = {
      ListingCard: <ListingCard listing={destacado} />,
      ListingCardWide: <ListingCardWide listing={destacado} />,
      'FloatingCard (mapa)': (
        <FloatingCard listing={destacado} pos={{ x: 10, y: 10 }} containerW={400} onClose={() => {}} />
      ),
      'SelectedListingPanel (mapa)': (
        <SelectedListingPanel listing={destacado} attributeMap={{}} onClose={() => {}} />
      ),
    };

    for (const [nombre, elemento] of Object.entries(superficies)) {
      const { unmount } = render(elemento);
      const encontrada = screen.queryByTestId('card-destacado');
      expect(nombre && encontrada).not.toBeNull();
      unmount();
    }
  });

  it('sin destacar, ninguna superficie pinta etiqueta', () => {
    const normal = anuncio({ boostScore: 0 });

    const { unmount } = render(<ListingCard listing={normal} />);
    expect(screen.queryByTestId('card-destacado')).toBeNull();
    unmount();

    render(
      <FloatingCard listing={normal} pos={{ x: 10, y: 10 }} containerW={400} onClose={() => {}} />,
    );
    expect(screen.queryByTestId('card-destacado')).toBeNull();
  });

  it('EN LA MINIATURA DE 56 px va COMPACTA — la píldora entera se saldría', () => {
    // La mutación «pintarla completa también aquí» muere en esta línea.
    render(
      <FloatingCard
        listing={anuncio({ boostScore: 1 })}
        pos={{ x: 10, y: 10 }}
        containerW={400}
        onClose={() => {}}
      />,
    );
    const badge = screen.getByTestId('card-destacado');
    expect(badge).toHaveAttribute('aria-label', 'Destacado');
    expect(badge).toHaveTextContent('');
  });

  it('en el panel de 130×100 SÍ cabe entera, y va entera', () => {
    render(
      <SelectedListingPanel
        listing={anuncio({ boostScore: 1 })}
        attributeMap={{}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('card-destacado')).toHaveTextContent('Destacado');
  });
});
