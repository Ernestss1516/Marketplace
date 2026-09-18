/**
 * EL HUECO DEL BANNER QUE NO SE PINTA — las barreras de maquetado.
 *
 * Diagnóstico completo en docs/diagnostico-hueco-banner-invisible.md. En una
 * frase: el espacio vivía FUERA del componente que decide si hay algo que
 * enseñar, así que el componente devolvía `null` y el envoltorio se quedaba con
 * su margen — 16 px visibles en la portada, y en otras nueve páginas un envoltorio
 * latente que sólo espera a que el vecino de arriba pierda el suyo.
 *
 * ── POR QUÉ ESTAS PRUEBAS NO MIRAN EL TEXTO ──────────────────────────────────
 *
 * Las dos que ya había en BlockRenderer.test.tsx comprueban
 * `container.textContent === ''`, y un `<div>` vacío con 64 px de margen las pasa
 * con sobresaliente: **texto no es espacio**. Aquí se mira la ESTRUCTURA —que no
 * quede nodo, o que el nodo que queda lleve encima lo que lo apaga—, que es lo
 * que de verdad se prometió. Los píxeles, que es lo único que zanja la
 * discusión, se miden en e2e/hueco-banner-invisible.spec.ts con un navegador de
 * verdad y el CSS de verdad.
 */

import { render, screen } from '@testing-library/react';
import { BannerList } from './BannerList';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import type { Banner } from '@/lib/api/banners';
import type { Block } from '@/types/blocks';

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

// react-markdown es ESM-only y next/jest no lo transforma — mismo mock y mismo
// motivo que BlockRenderer.test.tsx:44.
jest.mock('@/components/blog/MarkdownBody', () => ({
  MarkdownBody: ({ body }: { body: string }) => <div data-testid="markdown">{body}</div>,
}));

// next-auth/react también es ESM-only, y llega por ListingCard → el bloque
// `listings` → BlockRenderer. Mismo mock que BlockRenderer.test.tsx:53.
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: null }),
}));

const DISMISSED_KEY = 'dismissed-banners';

function banner(id: string): Banner {
  return {
    id,
    title: `Aviso ${id}`,
    text: 'Texto del aviso',
    linkUrl: null,
    linkText: null,
    placements: ['HOME'],
    variant: 'INFO',
    shareable: false,
    shareText: null,
    active: true,
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2030-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  localStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// BARRERA 1 — invisible colapsa a CERO
// ─────────────────────────────────────────────────────────────────────────────

describe('BARRERA 1 — el banner que no se pinta no deja nada detrás', () => {
  it('sin banners: ni un nodo en el DOM, aunque se le pase espaciado', () => {
    // El `className` es la trampa: es justo el espaciado que antes vivía en un
    // envoltorio y sobrevivía al `null`. Si alguien lo saca a un wrapper otra
    // vez, este `toBeEmptyDOMElement` lo caza.
    const { container } = render(<BannerList banners={[]} className="mb-6" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('EL CASO REAL: el servidor manda banners, el visitante ya los descartó → nada', () => {
    // Éste es el único camino que decide de CLIENTE, y por eso es el que dejaba
    // hueco: los tres de servidor (apagado, fuera de fecha, otra ubicación) nunca
    // llegan aquí — `getActiveBanners` ya devuelve [] y la página no monta nada.
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(['b1', 'b2']));

    const { container } = render(
      <BannerList banners={[banner('b1'), banner('b2')]} className="mb-6" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('descartado uno de dos: queda el otro, y el espaciado sigue puesto una sola vez', () => {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(['b1']));

    render(<BannerList banners={[banner('b1'), banner('b2')]} className="mb-6" />);

    expect(screen.queryByText('Aviso b1')).not.toBeInTheDocument();
    expect(screen.getByText('Aviso b2')).toBeInTheDocument();
    expect(screen.getAllByTestId('banner-list')).toHaveLength(1);
    expect(screen.getByTestId('banner-list')).toHaveClass('mb-6');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BARRERA 2 — visible, el espacio integrado
// ─────────────────────────────────────────────────────────────────────────────

describe('BARRERA 2 — el banner que sí se pinta lleva su espacio encima', () => {
  it('el espaciado está EN LA RAÍZ de la lista, no en un envoltorio', () => {
    const { container } = render(<BannerList banners={[banner('b1')]} className="mb-6" />);

    // Un solo elemento a nivel de página, y es el que lleva el margen. Si
    // volviera el envoltorio, el hijo único del container sería un div sin
    // `space-y-3` y esta comprobación se caería.
    expect(container.children).toHaveLength(1);
    const raiz = container.firstElementChild!;
    expect(raiz).toBe(screen.getByTestId('banner-list'));
    expect(raiz).toHaveClass('mb-6', 'space-y-3');
  });

  it('sin `className` (las páginas de cuenta, dentro de su `space-y-*`) el ritmo es del contenedor', () => {
    // Las seis de cuenta NO pasan espaciado a propósito: su `space-y-*` ya lo da,
    // y añadirlo aquí doblaría el hueco (diseno-banners-ubicaciones.md §3.3).
    render(<BannerList banners={[banner('b1')]} />);
    expect(screen.getByTestId('banner-list')).toHaveClass('space-y-3');
    expect(screen.getByTestId('banner-list').className).not.toMatch(/\bmb-/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BARRERA 4 — la clase, no el caso: el mismo defecto en el motor de bloques
// ─────────────────────────────────────────────────────────────────────────────

describe('BARRERA 4 — el envoltorio por bloque se apaga cuando el bloque no pinta', () => {
  const bloqueInvisible: Block = {
    id: 'malo',
    type: 'image',
    // Dominio no permitido → ImageBlockRenderer devuelve null (isSafeSrc).
    url: 'https://dominio-no-permitido.example/x.png',
    alt: 'x',
  };
  const bloqueVisible = (id: string): Block => ({ id, type: 'text', markdown: 'Un párrafo' });

  it('el envoltorio que se queda vacío lleva `empty:hidden` (no genera caja, ni margen)', () => {
    const { container } = render(<BlockRenderer blocks={[bloqueVisible('b1'), bloqueInvisible]} />);

    // `:empty` casa con el elemento sin hijos — el estado exacto de un envoltorio
    // cuyo bloque devolvió null, y sólo ése. Que ADEMÁS lleve la clase que lo
    // esconde es lo que impide que su margen se escape por el final del
    // contenedor (docs/diagnostico-hueco-banner-invisible.md §2.2).
    const vacios = container.querySelectorAll('div:empty');
    expect(vacios).toHaveLength(1);
    expect(vacios[0]).toHaveClass('empty:hidden');
  });

  it('TODOS los envoltorios la llevan — el bloque que se esconde no se sabe de antemano', () => {
    // El padre no puede saber qué hijo devolverá null sin renderizarlo, así que
    // la clase va en los catorce o no sirve de nada. Poner el arreglo sólo en el
    // bloque de publicidad —que es por donde se vio— dejaría el hueco para los
    // otros tres que también se esconden.
    const { container } = render(
      <BlockRenderer blocks={[bloqueVisible('b1'), bloqueInvisible, bloqueVisible('b2')]} />,
    );

    const ritmo = container.querySelector('[class*="ritmo-bloques"]')!;
    expect(ritmo.children).toHaveLength(3);
    for (const hijo of ritmo.children) {
      expect(hijo).toHaveClass('empty:hidden');
    }
  });

  it('con el bloque visible, el envoltorio no está vacío y nada se esconde', () => {
    const { container } = render(<BlockRenderer blocks={[bloqueVisible('b1'), bloqueVisible('b2')]} />);
    expect(container.querySelectorAll('div:empty')).toHaveLength(0);
  });
});
