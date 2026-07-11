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

jest.mock('next/link', () => {
  return function MockLink({ href, children, ...props }: { href: string; children: React.ReactNode }) {
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
