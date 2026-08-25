/**
 * P2B — LA TRANSPARENCIA DEL BLOQUE «PROMOCIONADOS».
 *
 * El otro lado del mercado. R3 y R4 cerraron la honestidad con el VENDEDOR (sabe que compra un
 * turno, y con cuántos competiría). Esto la cierra con el COMPRADOR: lo que ve arriba es
 * publicidad, no relevancia, y hasta ahora nada se lo decía.
 *
 * POR QUÉ NO BASTABA LA PALABRA «Promocionados»: se puede leer como «rebajados», «recomendados
 * por la plataforma» o «los mejores». La lectura correcta —el vendedor ha pagado— no estaba
 * escrita en ninguna parte (auditoría §5). Y desde R2 el bloque tampoco sigue el orden pedido,
 * así que un comprador que ordena por precio y ve cuatro anuncios arriba puede creer que son
 * los más baratos.
 *
 * LAS MUTACIONES QUE ESTO MATA:
 *  · dejar sólo «Promocionados» → la ambigüedad vuelve entera;
 *  · quitar la línea que explica que no es un orden por relevancia → sigue pareciendo un
 *    ranking, que es justo lo que R2 hizo que NO fuera;
 *  · el `aria-label` viejo → quien navega con lector de pantalla se queda sin saberlo;
 *  · etiquetar el patrocinado con otra palabra → dos vocabularios para lo mismo.
 */

import { render, screen } from '@testing-library/react';
import { FeaturedBlock } from './FeaturedBlock';
import { SponsoredCard } from '@/components/anuncios/SponsoredCard';
import { PublicidadBadge } from '@/components/anuncios/PublicidadBadge';
import type { ListingSummary, SponsoredAdHit } from '@/types';

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
  usePathname: () => '/',
}));

const anuncio = (id: string): ListingSummary =>
  ({
    id,
    title: `Anuncio ${id}`,
    slug: `anuncio-${id}`,
    price: 1000,
    currency: 'EUR',
    priceType: 'FIXED',
    status: 'ACTIVE',
    boostScore: 1,
    categorySlug: 'coches',
    hasVideo: false,
  }) as ListingSummary;

const patrocinado: SponsoredAdHit = {
  __sponsored: true,
  id: 'ad-1',
  title: 'Un anunciante',
  description: 'Su mensaje',
  imageUrl: 'https://cdn.test/ad.jpg',
  targetUrl: 'https://anunciante.example',
} as SponsoredAdHit;

describe('BARRERA 1 — el bloque dice que es publicidad de pago', () => {
  it('lleva la etiqueta «Publicidad», no sólo la palabra ambigua', () => {
    render(<FeaturedBlock listings={[anuncio('a')]} />);

    expect(screen.getByTestId('etiqueta-publicidad')).toHaveTextContent('Publicidad');
    // «Promocionados» se queda: es el rótulo con el que ya se reconoce el bloque. Lo que
    // cambia es que ya no viaja solo.
    expect(screen.getByText('Promocionados')).toBeInTheDocument();
  });

  it('y explica QUIÉN paga y que NO es un orden por relevancia', () => {
    // Las dos mitades de la ambigüedad. Sin la primera, «Promocionados» podría ser una
    // recomendación de la casa; sin la segunda —y desde R2 el bloque ni siquiera sigue el
    // orden pedido— parecería un ranking de los mejores.
    render(<FeaturedBlock listings={[anuncio('a')]} />);

    const aviso = screen.getByTestId('aviso-publicidad');
    expect(aviso).toHaveTextContent('han pagado por aparecer aquí');
    expect(aviso).toHaveTextContent('No es un orden por relevancia');
  });

  it('no promete «los mejores» ni «recomendados»: las lecturas falsas no aparecen', () => {
    render(<FeaturedBlock listings={[anuncio('a')]} />);
    const seccion = screen.getByRole('region');

    expect(seccion.textContent).not.toMatch(/recomendad|mejores|selecci[oó]n|rebajad/i);
  });
});

describe('BARRERA 2 — accesible: el lector de pantalla también lo sabe', () => {
  it('el nombre de la sección empieza por «Publicidad»', () => {
    // Quien navega por secciones oye este rótulo ANTES que el contenido; si la palabra fuera
    // al final, o no estuviera, se enteraría tarde o no se enteraría.
    render(<FeaturedBlock listings={[anuncio('a')]} />);

    const seccion = screen.getByRole('region');
    expect(seccion).toHaveAccessibleName(/^Publicidad/);
    expect(seccion).not.toHaveAccessibleName('Anuncios promocionados'); // el rótulo viejo
  });
});

describe('BARRERA 3 — UN vocabulario, no dos', () => {
  it('el patrocinado y el bloque de destacados usan LA MISMA etiqueta', () => {
    // La razón de que la etiqueta sea un componente y no dos cadenas sueltas: si cada bloque
    // escribiera la suya, el sitio acabaría llamando «publicidad» a una y «promocionado» a la
    // otra, y el visitante tendría que deducir que son lo mismo.
    const { unmount } = render(<SponsoredCard ad={patrocinado} />);
    const enPatrocinado = screen.getByTestId('etiqueta-publicidad').textContent;
    unmount();

    render(<FeaturedBlock listings={[anuncio('a')]} />);
    expect(screen.getByTestId('etiqueta-publicidad').textContent).toBe(enPatrocinado);
  });

  it('sobre una tarjeta va superpuesta; en una cabecera, en línea', () => {
    // Lo mismo que ya se decidió para el indicador de vídeo: cambia dónde se apoya, no qué
    // dice. En la cabecera de una sección no hay foto debajo contra la que posicionarse.
    const { unmount } = render(<PublicidadBadge />);
    expect(screen.getByTestId('etiqueta-publicidad').className).toContain('absolute');
    unmount();

    render(<PublicidadBadge inline />);
    expect(screen.getByTestId('etiqueta-publicidad').className).not.toContain('absolute');
  });
});

describe('BARRERA 4 — la señal es discreta y no rompe el bloque', () => {
  it('las tarjetas se siguen pintando, todas', () => {
    render(<FeaturedBlock listings={[anuncio('a'), anuncio('b'), anuncio('c'), anuncio('d')]} />);

    expect(screen.getAllByTestId('card-destacado')).toHaveLength(4);
    expect(screen.getByText('Anuncio a')).toBeInTheDocument();
    expect(screen.getByText('Anuncio d')).toBeInTheDocument();
  });

  it('el aviso es texto menor y atenuado, no un cartel', () => {
    render(<FeaturedBlock listings={[anuncio('a')]} />);
    const clases = screen.getByTestId('aviso-publicidad').className;

    expect(clases).toContain('text-xs');
    expect(clases).toContain('text-muted-foreground');
  });

  it('sin destacados no hay bloque — ni aviso de publicidad sobre nada', () => {
    const { container } = render(<FeaturedBlock listings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
