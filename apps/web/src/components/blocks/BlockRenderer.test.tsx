// SISTEMA DE BLOQUES — Ráfaga 1. Verifica que los 9 tipos se renderizan sin
// romper (el renderizador ES la validación barata del esquema: si un tipo no
// se puede pintar con la forma definida, el esquema está mal) — es decir,
// que BlockRenderer enruta cada `type` a su sub-renderizador con los props
// correctos.
//
// MarkdownBody (react-markdown) se mockea aquí: su cadena de dependencias
// (devlop, vía react-markdown v10) es ESM-only y next/jest no la transforma,
// igual que ningún otro test de este repo ejercita MarkdownBody directamente
// hoy. La regla de seguridad invariante ("un <script> literal en el bloque
// `text` se escapa, nunca se ejecuta") NO se pierde por este mock — sigue
// cubierta end-to-end, sin mocks, en e2e/paginas.spec.ts (Playwright, tubería
// real react-markdown+rehype-sanitize en un navegador real).

import { render, screen } from '@testing-library/react';
import { BlockRenderer } from './BlockRenderer';
import type { Block } from '@/types/blocks';
import type { ListingSummary } from '@/types';
import type { SearchResponse } from '@/lib/api/busqueda';

jest.mock('next/link', () => {
  // `prefetch` (booleano) no es un atributo DOM válido — ListingCard (bloque
  // `listings`, Ráfaga 3) lo pasa a <Link>; se descarta aquí para no
  // colarlo al <a> real y disparar el warning de React.
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

jest.mock('@/components/blog/MarkdownBody', () => ({
  MarkdownBody: ({ body }: { body: string }) => <div data-testid="markdown-body">{body}</div>,
}));

// next-auth/react es ESM-only (misma familia de problema que react-markdown/
// @uiw/react-md-editor, ver memoria de sesión) — next/jest no lo transforma
// por defecto. Solo lo arrastra ListingCard -> FavoriteCardButton, para el
// nuevo bloque `listings` de esta ráfaga. Mock mínimo: sin sesión, el botón
// de favorito ya degrada a `null` con gracia (ver FavoriteCardButton.tsx).
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: null }),
}));

const OWN_IMAGE_URL = 'http://localhost:9000/marketplace/media/test.jpg';

const ALL_BLOCKS: Block[] = [
  { id: 'b1', type: 'text', markdown: '# Encabezado\n\nTexto con **negrita**.' },
  {
    id: 'b2',
    type: 'faq',
    title: 'Preguntas frecuentes',
    items: [{ question: '¿Pregunta uno?', answer: 'Respuesta uno.' }],
  },
  {
    id: 'b3',
    type: 'hub',
    title: 'Enlaces',
    links: [
      { label: 'Buscar', href: '/busqueda', description: 'Explora' },
      { label: 'Externo', href: 'https://example.com' },
    ],
  },
  { id: 'b4', type: 'image', url: OWN_IMAGE_URL, alt: 'texto alternativo', caption: 'Un pie de foto' },
  { id: 'b5', type: 'cta', label: 'Publicar anuncio', href: '/publicar' },
  { id: 'b6', type: 'quote', text: 'Una cita memorable', author: 'Autor Ejemplo' },
  { id: 'b7', type: 'video', provider: 'youtube', videoId: 'dQw4w9WgXcQ' },
  { id: 'b8', type: 'separator' },
  {
    id: 'b9',
    type: 'table',
    headers: ['Columna A', 'Columna B'],
    rows: [['1', '2'], ['3', '4']],
  },
];

describe('BlockRenderer — los 9 tipos se renderizan', () => {
  it('text: enruta al bloque a MarkdownBody con el markdown correcto', () => {
    render(<BlockRenderer blocks={[ALL_BLOCKS[0]]} />);
    expect(screen.getByTestId('markdown-body')).toHaveTextContent('Encabezado');
    expect(screen.getByTestId('markdown-body')).toHaveTextContent('negrita');
  });

  it('faq: renderiza el título y las preguntas del acordeón', () => {
    render(<BlockRenderer blocks={[ALL_BLOCKS[1]]} />);
    expect(screen.getByText('Preguntas frecuentes')).toBeInTheDocument();
    expect(screen.getByText('¿Pregunta uno?')).toBeInTheDocument();
  });

  it('hub: enlace interno usa <Link>, enlace externo abre en pestaña nueva con rel seguro', () => {
    render(<BlockRenderer blocks={[ALL_BLOCKS[2]]} />);
    const internalLink = screen.getByRole('link', { name: /Buscar/ });
    expect(internalLink).toHaveAttribute('href', '/busqueda');
    expect(internalLink).not.toHaveAttribute('target');

    const externalLink = screen.getByRole('link', { name: 'Externo' });
    expect(externalLink).toHaveAttribute('href', 'https://example.com');
    expect(externalLink).toHaveAttribute('target', '_blank');
    expect(externalLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('image: renderiza con alt y caption', () => {
    render(<BlockRenderer blocks={[ALL_BLOCKS[3]]} />);
    const img = screen.getByAltText('texto alternativo');
    expect(img).toHaveAttribute('src', OWN_IMAGE_URL);
    expect(screen.getByText('Un pie de foto')).toBeInTheDocument();
  });

  it('cta: renderiza como botón-enlace interno', () => {
    render(<BlockRenderer blocks={[ALL_BLOCKS[4]]} />);
    const link = screen.getByRole('link', { name: 'Publicar anuncio' });
    expect(link).toHaveAttribute('href', '/publicar');
  });

  it('quote: renderiza el texto y el autor', () => {
    render(<BlockRenderer blocks={[ALL_BLOCKS[5]]} />);
    expect(screen.getByText(/Una cita memorable/)).toBeInTheDocument();
    expect(screen.getByText(/Autor Ejemplo/)).toBeInTheDocument();
  });

  it('video: construye un iframe controlado hacia youtube-nocookie con el videoId', () => {
    const { container } = render(<BlockRenderer blocks={[ALL_BLOCKS[6]]} />);
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('separator: renderiza un separador visual', () => {
    const { container } = render(<BlockRenderer blocks={[ALL_BLOCKS[7]]} />);
    expect(container.querySelector('[role="separator"], [data-orientation]')).not.toBeNull();
  });

  it('table: renderiza headers y filas', () => {
    render(<BlockRenderer blocks={[ALL_BLOCKS[8]]} />);
    expect(screen.getByText('Columna A')).toBeInTheDocument();
    expect(screen.getByText('Columna B')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('los 9 tipos combinados se renderizan sin lanzar (smoke test del switch exhaustivo)', () => {
    expect(() => render(<BlockRenderer blocks={ALL_BLOCKS} />)).not.toThrow();
  });
});

// ── Ráfaga 3 — 4 tipos nuevos ────────────────────────────────────────────────

function fakeListing(overrides: Partial<ListingSummary> = {}): ListingSummary {
  return {
    id: 'l1',
    title: 'Un anuncio de prueba',
    slug: 'un-anuncio-de-prueba',
    price: 100,
    currency: 'EUR',
    priceType: 'FIXED',
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('BlockRenderer — Ráfaga 3 (4 tipos nuevos)', () => {
  it('imageText: renderiza la imagen y el texto (composición de las dos piezas existentes)', () => {
    const block: Block = {
      id: 'b1',
      type: 'imageText',
      image: { url: OWN_IMAGE_URL, alt: 'alt imageText', caption: 'pie' },
      markdown: 'Texto compuesto',
      layout: 'imageLeft',
    };
    render(<BlockRenderer blocks={[block]} />);
    expect(screen.getByAltText('alt imageText')).toHaveAttribute('src', OWN_IMAGE_URL);
    expect(screen.getByTestId('markdown-body')).toHaveTextContent('Texto compuesto');
  });

  it('steps: renderiza título, pasos numerados y la imagen opcional de un paso', () => {
    const block: Block = {
      id: 'b1',
      type: 'steps',
      title: 'Cómo funciona',
      items: [
        { title: 'Paso uno', description: 'Descripción uno' },
        { title: 'Paso dos', description: 'Descripción dos', image: OWN_IMAGE_URL },
      ],
    };
    render(<BlockRenderer blocks={[block]} />);
    expect(screen.getByText('Cómo funciona')).toBeInTheDocument();
    expect(screen.getByText('Paso uno')).toBeInTheDocument();
    expect(screen.getByText('Paso dos')).toBeInTheDocument();
    expect(screen.getByAltText('Paso dos')).toHaveAttribute('src', OWN_IMAGE_URL);
  });

  it('profile: renderiza nombre, imagen y la lista de atributos', () => {
    const block: Block = {
      id: 'b1',
      type: 'profile',
      name: 'Ana',
      image: { url: OWN_IMAGE_URL, alt: 'Ana' },
      attributes: [
        { label: 'Experiencia', value: '10 años' },
        { label: 'Especialidad', value: 'Fontanería' },
      ],
    };
    render(<BlockRenderer blocks={[block]} />);
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByAltText('Ana')).toHaveAttribute('src', OWN_IMAGE_URL);
    expect(screen.getByText('Experiencia:')).toBeInTheDocument();
    expect(screen.getByText('10 años')).toBeInTheDocument();
  });

  it('listings: con datos resueltos, renderiza las tarjetas y el badge "Destacado" si boostScore=1', () => {
    const block: Block = {
      id: 'b1',
      type: 'listings',
      title: 'Anuncios destacados',
      categorySlug: 'electronica',
      limit: 8,
    };
    const data: SearchResponse = {
      hits: [fakeListing({ id: 'l1', title: 'Anuncio destacado', boostScore: 1 })],
      totalHits: 1,
      page: 1,
      hitsPerPage: 8,
    };
    render(<BlockRenderer blocks={[block]} listingsData={{ b1: data }} />);
    expect(screen.getByText('Anuncios destacados')).toBeInTheDocument();
    expect(screen.getByText('Anuncio destacado')).toBeInTheDocument();
    expect(screen.getByText('Destacado')).toBeInTheDocument();
  });

  it('listings: sin datos resueltos (aún no llegó SSR) → no renderiza nada (no deja un hueco)', () => {
    const block: Block = { id: 'b1', type: 'listings', categorySlug: 'electronica', limit: 8 };
    const { container } = render(<BlockRenderer blocks={[block]} />);
    expect(container.querySelector('.space-y-8')?.textContent).toBe('');
  });

  it('listings: categoría vacía (totalHits=0) → oculta el bloque, no deja un hueco', () => {
    const block: Block = { id: 'b1', type: 'listings', categorySlug: 'electronica', limit: 8 };
    const data: SearchResponse = { hits: [], totalHits: 0, page: 1, hitsPerPage: 8 };
    const { container } = render(<BlockRenderer blocks={[block]} listingsData={{ b1: data }} />);
    expect(container.querySelector('.space-y-8')?.textContent).toBe('');
  });

  it('listings: patrocinados excluidos, solo se pintan anuncios reales', () => {
    const block: Block = { id: 'b1', type: 'listings', categorySlug: 'electronica', limit: 8 };
    const sponsoredHit = {
      __sponsored: true,
      id: 's1',
      title: 'Patrocinado',
      imageUrl: OWN_IMAGE_URL,
      href: 'https://example.com',
    } as unknown as ListingSummary;
    const data: SearchResponse = {
      hits: [fakeListing({ id: 'l1', title: 'Anuncio real' }), sponsoredHit],
      totalHits: 2,
      page: 1,
      hitsPerPage: 8,
    };
    render(<BlockRenderer blocks={[block]} listingsData={{ b1: data }} />);
    expect(screen.getByText('Anuncio real')).toBeInTheDocument();
    expect(screen.queryByText('Patrocinado')).not.toBeInTheDocument();
  });

  it('listings: showAllLink añade el enlace "Ver todos" hacia /busqueda?category=', () => {
    const block: Block = {
      id: 'b1',
      type: 'listings',
      categorySlug: 'electronica',
      limit: 8,
      showAllLink: true,
    };
    const data: SearchResponse = { hits: [fakeListing()], totalHits: 1, page: 1, hitsPerPage: 8 };
    render(<BlockRenderer blocks={[block]} listingsData={{ b1: data }} />);
    const link = screen.getByRole('link', { name: /Ver todos/ });
    expect(link).toHaveAttribute('href', '/busqueda?category=electronica');
  });

  it('los 13 tipos combinados (9 + 4 nuevos) se renderizan sin lanzar', () => {
    const extraBlocks: Block[] = [
      {
        id: 'b10',
        type: 'imageText',
        image: { url: OWN_IMAGE_URL, alt: 'alt' },
        markdown: 'texto',
        layout: 'imageRight',
      },
      { id: 'b11', type: 'steps', items: [{ title: 't', description: 'd' }] },
      { id: 'b12', type: 'profile', attributes: [{ label: 'l', value: 'v' }] },
      { id: 'b13', type: 'listings', categorySlug: 'electronica', limit: 4 },
    ];
    expect(() => render(<BlockRenderer blocks={[...ALL_BLOCKS, ...extraBlocks]} />)).not.toThrow();
  });
});
