/**
 * EL PATROCINADO INTERCALADO TIENE QUE VERSE COMO SUS VECINOS — y seguir diciendo que es
 * publicidad.
 *
 * ── EL FALLO QUE ESTO CIERRA ────────────────────────────────────────────────────────────
 *
 * En la vista AMPLIADA los anuncios son tarjetas anchas de una columna (foto a la
 * izquierda, contenido a la derecha) y el patrocinado seguía pintando la tarjeta cuadrada
 * de rejilla: lado a lado desentonaban. La causa NO fue «se olvidaron de pasarle la
 * variante» — es que `SponsoredCard` no tenía variantes: un único formato, el de la
 * rejilla, pasara lo que pasara en la lista.
 *
 * ── POR QUÉ SE COMPARA EL CHASIS Y NO UNA CAPTURA ──────────────────────────────────────
 *
 * Porque lo que hay que garantizar no es «el patrocinado tiene estas clases», que envejece
 * en cuanto alguien retoque la tarjeta: es que TIENE LAS MISMAS QUE SU VECINO. Se compara
 * la firma del molde (`card-shells.tsx`) entre el patrocinado y el anuncio normal de la
 * MISMA lista, así que el día que el formato cambie, cambia para los dos o esto se pone
 * rojo.
 *
 * LAS MUTACIONES QUE MATA:
 *  · el patrocinado con otro componente/molde (el fallo original) → las firmas difieren;
 *  · pasarle siempre la misma variante, ignorando el modo activo → difieren en AMPLIADA;
 *  · igualar el formato a costa de la marca —quitar el `rel="sponsored"` o la etiqueta
 *    «Publicidad»— → BARRERA 2. Las dos cosas a la vez o nada.
 */

import { render, screen, within } from '@testing-library/react';
import { ResultsList } from './ResultsList';
import type { ListingSummary, SponsoredAdHit } from '@/types';
import type { SearchHit } from '@/lib/api/busqueda';

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
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/busqueda',
}));

const anuncio = (id: string): ListingSummary =>
  ({
    id,
    title: `Anuncio ${id}`,
    slug: `anuncio-${id}`,
    description: 'Descripción del anuncio',
    price: 1000,
    currency: 'EUR',
    priceType: 'FIXED',
    status: 'ACTIVE',
    boostScore: 0,
    categorySlug: 'coches',
    hasVideo: false,
    thumbnailUrl: 'https://cdn.test/foto.jpg',
  }) as ListingSummary;

const patrocinado: SponsoredAdHit = {
  __sponsored: true,
  id: 'ad-1',
  title: 'Un anunciante',
  description: 'Su mensaje',
  imageUrl: 'https://cdn.test/ad.jpg',
  targetUrl: 'https://anunciante.example',
};

/** Un patrocinado ENTRE dos anuncios: la situación real que se veía mal. */
const HITS: SearchHit[] = [anuncio('a'), patrocinado, anuncio('b')];

/** Los dos modos de lista que pintan tarjetas. MAPA no pinta ninguna (ver `ResultsList`). */
const MODOS = [
  { vista: 'AMPLIADA' as const, chasis: 'chasis-ampliada', variante: 'wide' },
  { vista: 'LISTA' as const, chasis: 'chasis-rejilla', variante: 'grid' },
];

/**
 * La firma del molde: la caja, la PROPORCIÓN DE LA FOTO —que es donde se veía el
 * desajuste: un cuadrado entre tarjetas apaisadas— y la columna de contenido. Es lo que
 * hace a dos tarjetas «del mismo formato» sin fijar cuál es ese formato.
 */
function firmaDelChasis(chasis: HTMLElement): string {
  const foto = chasis.querySelector('[class*="aspect-"]');
  const contenido = chasis.querySelector('[class*="p-3"], [class*="p-4"]');
  return [
    chasis.className,
    foto?.className ?? '(sin foto)',
    contenido?.className ?? '(sin columna de contenido)',
  ].join(' >> ');
}

describe.each(MODOS)('BARRERA 1 — mismo formato que sus vecinos ($vista)', ({ vista, chasis }) => {
  it('el patrocinado usa el MISMO chasis que el anuncio normal de la lista', () => {
    render(<ResultsList hits={HITS} view={vista} />);

    const tarjetaPatrocinada = screen.getByTestId('sponsored-card');
    const chasisPatrocinado = within(tarjetaPatrocinada).getByTestId(chasis);

    // El vecino: el chasis de un anuncio normal de esta misma lista.
    const chasisNormales = screen
      .getAllByTestId(chasis)
      .filter((c) => c !== chasisPatrocinado);
    expect(chasisNormales.length).toBeGreaterThan(0);

    expect(firmaDelChasis(chasisPatrocinado)).toBe(firmaDelChasis(chasisNormales[0]));
  });

  it('y su foto se pide al servidor con los mismos `sizes` que la del vecino', () => {
    // El otro medio formato: dos tarjetas del mismo tamaño que pidieran imágenes de
    // anchos distintos se verían igual de nítidas por casualidad, no por diseño.
    render(<ResultsList hits={HITS} view={vista} />);

    const fotoPatrocinada = within(screen.getByTestId('sponsored-card')).getByRole('img');
    const fotoVecina = screen
      .getAllByRole('img')
      .find((img) => img !== fotoPatrocinada);

    expect(fotoPatrocinada.getAttribute('sizes')).toBe(fotoVecina?.getAttribute('sizes'));
  });

  it('y no hay ningún chasis del OTRO formato colado en la lista', () => {
    // La forma exacta que tenía el fallo: en AMPLIADA aparecía un `chasis-rejilla`
    // (el patrocinado) entre tarjetas anchas.
    const otro = chasis === 'chasis-ampliada' ? 'chasis-rejilla' : 'chasis-ampliada';
    render(<ResultsList hits={HITS} view={vista} />);

    expect(screen.queryByTestId(otro)).toBeNull();
  });
});

describe.each(MODOS)('BARRERA 2 — la marca de patrocinado se conserva ($vista)', ({ vista, variante }) => {
  it('el enlace lleva rel="sponsored" SIN perder los dos de seguridad', () => {
    render(<ResultsList hits={HITS} view={vista} />);

    const enlace = screen.getByTestId('sponsored-card');
    const rel = (enlace.getAttribute('rel') ?? '').split(/\s+/);

    // `sponsored`: es un enlace pagado y así se le dice al buscador (igual que el banner
    // de portada). `noopener noreferrer`: obligatorio con target=_blank a un dominio
    // ajeno — el SEO no puede desplazar a la seguridad, se suman.
    expect(rel).toContain('sponsored');
    expect(rel).toContain('noopener');
    expect(rel).toContain('noreferrer');
    expect(enlace).toHaveAttribute('target', '_blank');
    expect(enlace).toHaveAttribute('href', patrocinado.targetUrl);
  });

  it('y la etiqueta «Publicidad» sigue sobre la foto', () => {
    render(<ResultsList hits={HITS} view={vista} />);

    const etiqueta = within(screen.getByTestId('sponsored-card')).getByTestId(
      'etiqueta-publicidad',
    );
    expect(etiqueta).toHaveTextContent('Publicidad');
    // Superpuesta, no en línea: hay una foto debajo contra la que posicionarse.
    expect(etiqueta.className).toContain('absolute');
  });

  it('la tarjeta declara la variante con la que se pintó', () => {
    render(<ResultsList hits={HITS} view={vista} />);
    expect(screen.getByTestId('sponsored-card')).toHaveAttribute('data-variant', variante);
  });
});

describe('BARRERA 3 — todos los modos de lista, y el sitio donde va el patrocinado', () => {
  it('cada modo pinta su rejilla o su columna, con el patrocinado intercalado en su sitio', () => {
    const { rerender } = render(<ResultsList hits={HITS} view="AMPLIADA" />);
    let contenedor = screen.getByTestId('resultados-ampliada');
    expect(contenedor.children).toHaveLength(3);
    expect(contenedor.children[1]).toHaveAttribute('data-testid', 'sponsored-card');

    rerender(<ResultsList hits={HITS} view="LISTA" />);
    contenedor = screen.getByTestId('resultados-rejilla');
    expect(contenedor.children).toHaveLength(3);
    expect(contenedor.children[1]).toHaveAttribute('data-testid', 'sponsored-card');
  });

  it('una lista sin patrocinado no pinta ninguno (el intercalado no se inventa nada)', () => {
    render(<ResultsList hits={[anuncio('a'), anuncio('b')]} view="AMPLIADA" />);
    expect(screen.queryByTestId('sponsored-card')).toBeNull();
  });
});
