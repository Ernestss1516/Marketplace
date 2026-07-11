// SISTEMA DE BLOQUES — Ráfaga 2 (editor). Andamiaje: añadir cada uno de los 9
// tipos, reordenar (flechas ↑↓ deshabilitadas en extremos), borrar, y que el
// preview usa el mismo BlockRenderer que el sitio público.
//
// No usamos @testing-library/user-event (no está entre las devDependencies
// del workspace, ver AttributeSchemaEditor.test.tsx) — fireEvent cubre los
// mismos casos para inputs controlados de un solo `onChange`.

import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { BlockEditor } from './BlockEditor';
import { BLOCK_TYPE_META, BLOCK_TYPE_ORDER } from './blockDefaults';
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

// MarkdownEditorClient carga @uiw/react-md-editor vía dynamic import
// (ssr:false) — mockeado aquí para que el andamiaje se pruebe sin depender
// de esa librería pesada; el wrapper TextBlockEditor en sí no tiene lógica
// propia que este mock oculte (solo reenvía value/onChange).
jest.mock('../MarkdownEditorClient', () => {
  return function MockMarkdownEditorClient({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) {
    return (
      <textarea data-testid="mock-markdown-editor" value={value} onChange={(e) => onChange(e.target.value)} />
    );
  };
});

// Wrapper con estado real (como haría PostForm) — un `onChange` jest.fn()
// "hueco" dejaría los inputs controlados congelados en su valor inicial tras
// fireEvent.change, porque React nunca los re-renderiza con el valor nuevo.
function StatefulBlockEditor({
  initialBlocks,
  onChange,
}: {
  initialBlocks: Block[];
  onChange: (blocks: Block[]) => void;
}) {
  const [blocks, setBlocks] = useState(initialBlocks);
  return (
    <BlockEditor
      blocks={blocks}
      onChange={(next) => {
        setBlocks(next);
        onChange(next);
      }}
      token="fake-token"
    />
  );
}

function renderEditor(initialBlocks: Block[] = []) {
  const onChange = jest.fn();
  const utils = render(<StatefulBlockEditor initialBlocks={initialBlocks} onChange={onChange} />);
  return { ...utils, onChange };
}

describe('BlockEditor — andamiaje', () => {
  it('sin bloques: muestra el estado vacío y el selector de tipos', () => {
    renderEditor([]);
    expect(screen.getByText('Sin contenido todavía. Añade el primer bloque abajo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Añadir bloque/ })).toBeInTheDocument();
  });

  it('el selector muestra los 9 tipos con nombre y descripción en lenguaje claro', () => {
    renderEditor([]);
    fireEvent.click(screen.getByRole('button', { name: /Añadir bloque/ }));

    for (const type of BLOCK_TYPE_ORDER) {
      const meta = BLOCK_TYPE_META[type];
      expect(screen.getByText(meta.label)).toBeInTheDocument();
      expect(screen.getByText(meta.description)).toBeInTheDocument();
    }
  });

  it.each(BLOCK_TYPE_ORDER)('añadir un bloque "%s" lo agrega al array con un id fresco', (type) => {
    const { onChange } = renderEditor([]);
    fireEvent.click(screen.getByRole('button', { name: /Añadir bloque/ }));
    fireEvent.click(screen.getByText(BLOCK_TYPE_META[type].label));

    expect(onChange).toHaveBeenCalledTimes(1);
    const [added] = onChange.mock.calls[0][0] as Block[];
    expect(added.type).toBe(type);
    expect(typeof added.id).toBe('string');
    expect(added.id.length).toBeGreaterThan(0);
  });

  it('reordenar: la flecha ↑ del primer bloque está deshabilitada, la ↓ del último también', () => {
    const blocks: Block[] = [
      { id: 'a', type: 'separator' },
      { id: 'b', type: 'separator' },
    ];
    renderEditor(blocks);
    const upButtons = screen.getAllByTitle('Subir');
    expect(upButtons[0]).toBeDisabled();
    expect(upButtons[upButtons.length - 1]).not.toBeDisabled();

    const downButtons = screen.getAllByTitle('Bajar');
    expect(downButtons[0]).not.toBeDisabled();
    expect(downButtons[downButtons.length - 1]).toBeDisabled();
  });

  it('reordenar: la flecha ↓ del primer bloque intercambia su posición con el segundo', () => {
    const blocks: Block[] = [
      { id: 'a', type: 'quote', text: 'Primero' },
      { id: 'b', type: 'quote', text: 'Segundo' },
    ];
    const { onChange } = renderEditor(blocks);

    fireEvent.click(screen.getAllByTitle('Bajar')[0]);

    expect(onChange).toHaveBeenCalledWith([
      { id: 'b', type: 'quote', text: 'Segundo' },
      { id: 'a', type: 'quote', text: 'Primero' },
    ]);
  });

  it('borrar un bloque SIN contenido lo quita directamente (sin confirmación)', () => {
    const blocks: Block[] = [{ id: 'a', type: 'quote', text: '' }];
    const { onChange } = renderEditor(blocks);

    fireEvent.click(screen.getByTitle('Quitar bloque'));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('borrar un bloque CON contenido pide confirmación antes de quitarlo', () => {
    const blocks: Block[] = [{ id: 'a', type: 'quote', text: 'Contenido real' }];
    const { onChange } = renderEditor(blocks);

    fireEvent.click(screen.getByTitle('Quitar bloque'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Seguro/)).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Quitar bloque'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('preview usa el mismo BlockRenderer que el sitio público', () => {
    const blocks: Block[] = [{ id: 'a', type: 'quote', text: 'Cita de preview', author: 'Autor X' }];
    renderEditor(blocks);

    fireEvent.click(screen.getByRole('button', { name: /Ver preview/ }));

    expect(screen.getByText('Preview — así se ve publicado')).toBeInTheDocument();
    expect(screen.getByText(/Cita de preview/)).toBeInTheDocument();
    expect(screen.getByText(/Autor X/)).toBeInTheDocument();
  });
});

describe('BlockEditor — formularios producen bloques válidos', () => {
  it('quote: rellenar texto actualiza el bloque', () => {
    const blocks: Block[] = [{ id: 'a', type: 'quote', text: '' }];
    const { onChange } = renderEditor(blocks);

    const textInput = screen.getByPlaceholderText('La frase que quieres destacar');
    fireEvent.change(textInput, { target: { value: 'Hola mundo' } });

    const lastCall = onChange.mock.calls.at(-1)![0] as Block[];
    expect((lastCall[0] as { text: string }).text).toBe('Hola mundo');
  });

  it('cta: href con javascript: muestra el error inline claro', () => {
    const blocks: Block[] = [{ id: 'a', type: 'cta', label: 'x', href: '' }];
    renderEditor(blocks);

    const hrefInput = screen.getByPlaceholderText('/publicar o https://...');
    fireEvent.change(hrefInput, { target: { value: 'javascript:alert(1)' } });

    expect(screen.getByText(/El enlace debe empezar por/)).toBeInTheDocument();
  });

  it('cta: href relativo válido NO muestra error', () => {
    const blocks: Block[] = [{ id: 'a', type: 'cta', label: 'x', href: '' }];
    renderEditor(blocks);

    const hrefInput = screen.getByPlaceholderText('/publicar o https://...');
    fireEvent.change(hrefInput, { target: { value: '/publicar' } });

    expect(screen.queryByText(/El enlace debe empezar por/)).not.toBeInTheDocument();
  });

  it('hub: un link con href javascript: muestra el error inline', () => {
    const blocks: Block[] = [
      { id: 'a', type: 'hub', links: [{ label: 'x', href: '' }] },
    ];
    renderEditor(blocks);

    const hrefInput = screen.getByPlaceholderText('/busqueda o https://...');
    fireEvent.change(hrefInput, { target: { value: 'javascript:alert(1)' } });

    expect(screen.getByText(/El enlace debe empezar por/)).toBeInTheDocument();
  });

  it('faq: añadir una pregunta agrega un sub-ítem; quitar el único disponible está deshabilitado', () => {
    const blocks: Block[] = [{ id: 'a', type: 'faq', items: [{ question: '', answer: '' }] }];
    const { onChange } = renderEditor(blocks);

    // Con un solo ítem, "Quitar" está deshabilitado (ArrayMinSize(1) del backend).
    expect(screen.getByTitle('Debe haber al menos 1')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Añadir pregunta/ }));
    const updated = onChange.mock.calls.at(-1)![0][0] as { items: unknown[] };
    expect(updated.items).toHaveLength(2);
  });

  it('table: añadir columna añade una celda vacía a cada fila existente (mantiene la coherencia)', () => {
    const blocks: Block[] = [{ id: 'a', type: 'table', headers: ['A'], rows: [['1'], ['2']] }];
    const { onChange } = renderEditor(blocks);

    fireEvent.click(screen.getByRole('button', { name: /Columna/ }));

    const updated = onChange.mock.calls.at(-1)![0][0] as { headers: string[]; rows: string[][] };
    expect(updated.headers).toHaveLength(2);
    expect(updated.rows).toEqual([
      ['1', ''],
      ['2', ''],
    ]);
  });

  it('table: quitar columna cuando solo queda 1 está deshabilitado (mínimo 1 columna)', () => {
    const blocks: Block[] = [{ id: 'a', type: 'table', headers: ['A'], rows: [['1']] }];
    renderEditor(blocks);

    expect(screen.getByTitle('Debe haber al menos 1 columna')).toBeDisabled();
  });

  it('table: quitar una de dos columnas recorta esa celda de todas las filas', () => {
    const blocks: Block[] = [
      { id: 'a', type: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] },
    ];
    const { onChange } = renderEditor(blocks);

    fireEvent.click(screen.getAllByTitle('Quitar columna')[0]);

    const updated = onChange.mock.calls.at(-1)![0][0] as { headers: string[]; rows: string[][] };
    expect(updated.headers).toEqual(['B']);
    expect(updated.rows).toEqual([['2'], ['4']]);
  });

  it('table: añadir fila crea una fila con tantas celdas como headers', () => {
    const blocks: Block[] = [{ id: 'a', type: 'table', headers: ['A', 'B'], rows: [['1', '2']] }];
    const { onChange } = renderEditor(blocks);

    fireEvent.click(screen.getByRole('button', { name: /Añadir fila/ }));

    const updated = onChange.mock.calls.at(-1)![0][0] as { rows: string[][] };
    expect(updated.rows).toEqual([['1', '2'], ['', '']]);
  });

  it('video: URL de YouTube reconocida rellena provider/videoId y muestra preview', () => {
    const blocks: Block[] = [{ id: 'a', type: 'video', provider: 'youtube', videoId: '' }];
    const { onChange } = renderEditor(blocks);

    const input = screen.getByPlaceholderText(/youtube\.com/);
    fireEvent.change(input, { target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } });

    const updated = onChange.mock.calls.at(-1)![0][0] as { provider: string; videoId: string };
    expect(updated.provider).toBe('youtube');
    expect(updated.videoId).toBe('dQw4w9WgXcQ');
  });

  it('video: URL de Vimeo reconocida rellena provider/videoId', () => {
    const blocks: Block[] = [{ id: 'a', type: 'video', provider: 'youtube', videoId: '' }];
    const { onChange } = renderEditor(blocks);

    const input = screen.getByPlaceholderText(/youtube\.com/);
    fireEvent.change(input, { target: { value: 'https://vimeo.com/123456789' } });

    const updated = onChange.mock.calls.at(-1)![0][0] as { provider: string; videoId: string };
    expect(updated.provider).toBe('vimeo');
    expect(updated.videoId).toBe('123456789');
  });

  it('video: URL basura muestra un error claro y NO actualiza el bloque', () => {
    const blocks: Block[] = [{ id: 'a', type: 'video', provider: 'youtube', videoId: '' }];
    const { onChange } = renderEditor(blocks);

    const input = screen.getByPlaceholderText(/youtube\.com/);
    fireEvent.change(input, { target: { value: 'https://esto-no-es-un-video.example.com' } });

    expect(screen.getByText(/No reconocemos esta URL/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('text: escribir en el editor (mockeado) actualiza el markdown del bloque', () => {
    const blocks: Block[] = [{ id: 'a', type: 'text', markdown: '' }];
    const { onChange } = renderEditor(blocks);

    fireEvent.change(screen.getByTestId('mock-markdown-editor'), { target: { value: '# Hola' } });

    const updated = onChange.mock.calls.at(-1)![0][0] as { markdown: string };
    expect(updated.markdown).toBe('# Hola');
  });

  it('image: falta alt — el campo obligatorio está presente en el formulario', () => {
    const blocks: Block[] = [{ id: 'a', type: 'image', url: '', alt: '' }];
    renderEditor(blocks);
    expect(screen.getByPlaceholderText('Describe la imagen (accesibilidad y SEO)')).toBeInTheDocument();
  });

  it('separator: no tiene campos editables', () => {
    const blocks: Block[] = [{ id: 'a', type: 'separator' }];
    renderEditor(blocks);
    expect(screen.getByText(/Sin opciones/)).toBeInTheDocument();
  });
});

describe('BlockEditor — recargar preserva el array (persistencia simulada)', () => {
  it('re-renderizar con el array actualizado muestra los bloques ya guardados', () => {
    const saved: Block[] = [
      { id: 'a', type: 'quote', text: 'Persistido', author: 'X' },
      { id: 'b', type: 'separator' },
    ];
    const { rerender } = render(<BlockEditor blocks={[]} onChange={jest.fn()} token="t" />);
    rerender(<BlockEditor blocks={saved} onChange={jest.fn()} token="t" />);

    expect(screen.getByDisplayValue('Persistido')).toBeInTheDocument();
    expect(screen.getByText(BLOCK_TYPE_META.separator.label)).toBeInTheDocument();
  });
});
