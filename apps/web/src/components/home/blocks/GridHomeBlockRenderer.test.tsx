import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import type { HomeGridBlock, HomeGridCell } from '@/types/home-blocks';
import { GridHomeBlockRenderer } from './GridHomeBlockRenderer';

/**
 * REJILLA FLEXIBLE (ajuste 6) — las barreras del render.
 *
 * Lo que se afirma aquí son las dos mitades del ajuste: que **una tarjeta sin texto no deja
 * hueco** y que **las imágenes ocupan todas la misma caja** —con clases ESTÁTICAS, que es lo
 * único que Tailwind conserva—. Y, de paso, las dos cosas que NO debían cambiar: los iconos
 * de las señales de confianza y la degradación de una imagen de origen ajeno.
 */

const PROPIA = `${process.env.NEXT_PUBLIC_S3_PUBLIC_URL ?? 'http://localhost:9000/marketplace'}/homepage/a.jpg`;
const AJENA = 'https://evil.example.com/x.jpg';

function grid(items: HomeGridCell[], columns: HomeGridBlock['columns'] = 4): HomeGridBlock {
  return { id: 'g1', type: 'grid', columns, items };
}

const ICONO: HomeGridCell = { media: { kind: 'icon', name: 'shield-check' } };
const IMAGEN: HomeGridCell = { media: { kind: 'image', url: PROPIA, alt: 'Una foto' } };

describe('GridHomeBlockRenderer — la tarjeta sin texto no deja hueco', () => {
  it('con SOLO imagen no pinta ningún elemento de texto', () => {
    const { container } = render(<GridHomeBlockRenderer block={grid([IMAGEN])} />);

    expect(container.querySelector('img')).toBeInTheDocument();
    // LA BARRERA: antes el `<span>` del título se pintaba SIEMPRE, así que una tarjeta sin
    // texto reservaba una línea vacía. Ahora no existe el elemento, y por tanto tampoco el
    // `gap` del flex que lo separaría.
    expect(container.querySelectorAll('span')).toHaveLength(0);
  });

  it('con título sí lo pinta, y con descripción también', () => {
    render(
      <GridHomeBlockRenderer
        block={grid([{ ...IMAGEN, title: 'Un título', description: 'Una descripción' }])}
      />,
    );
    expect(screen.getByText('Un título')).toBeInTheDocument();
    expect(screen.getByText('Una descripción')).toBeInTheDocument();
  });

  it('una tarjeta sin texto y otra con él conviven en la misma rejilla', () => {
    const { container } = render(
      <GridHomeBlockRenderer block={grid([IMAGEN, { ...IMAGEN, title: 'Con texto' }])} />,
    );
    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect(screen.getByText('Con texto')).toBeInTheDocument();
  });
});

describe('GridHomeBlockRenderer — la adaptación al espacio', () => {
  it('las imágenes comparten caja: mismo aspect ratio y object-cover', () => {
    // Es lo que impide que dos imágenes de tamaños distintos descuadren la fila: ocupan
    // exactamente el mismo hueco y el recorte lo hace el navegador.
    const { container } = render(
      <GridHomeBlockRenderer
        block={grid([
          IMAGEN,
          { media: { kind: 'image', url: `${PROPIA}?otra`, alt: 'Otra' } },
        ])}
      />,
    );

    const imgs = [...container.querySelectorAll('img')];
    expect(imgs).toHaveLength(2);
    for (const img of imgs) {
      expect(img.className).toContain('aspect-[4/3]');
      expect(img.className).toContain('object-cover');
      expect(img.className).toContain('w-full');
    }
    // Las dos con LA MISMA clase: si una se calculara, aquí ya no coincidirían.
    expect(imgs[0].className).toBe(imgs[1].className);
  });

  it('las filas miden lo mismo aunque una tarjeta tenga más texto', () => {
    const { container } = render(
      <GridHomeBlockRenderer
        block={grid([IMAGEN, { ...IMAGEN, title: 'T', description: 'Una descripción larga' }])}
      />,
    );
    // `auto-rows-fr` en la rejilla + `h-full` en la tarjeta: alineadas arriba y abajo.
    expect(container.querySelector('.grid')?.className).toContain('auto-rows-fr');
    expect(container.querySelectorAll('.h-full').length).toBeGreaterThan(0);
  });

  /**
   * LAS COLUMNAS, CON IGUALDAD EXACTA Y NO `toContain`.
   *
   * Y la diferencia importa: la primera versión de esta prueba usaba `toContain` y **sobrevivió
   * a la mutación** que buscaba —cambiar el mapa estático por `sm:grid-cols-${n}`—, porque para
   * 3, 4 y 6 la cadena interpolada contiene igualmente lo que se buscaba. Lo que la delata es
   * lo que la interpolación PIERDE: el fallback de móvil (`grid-cols-2` antes del `sm:`), que
   * sólo existe en el mapa escrito a mano.
   */
  it.each([
    [1, 'grid auto-rows-fr gap-4 grid-cols-1'],
    [2, 'grid auto-rows-fr gap-4 grid-cols-2'],
    [3, 'grid auto-rows-fr gap-4 grid-cols-2 sm:grid-cols-3'],
    [4, 'grid auto-rows-fr gap-4 grid-cols-2 sm:grid-cols-4'],
    [6, 'grid auto-rows-fr gap-4 grid-cols-3 sm:grid-cols-6'],
  ] as const)('columns=%s aplica EXACTAMENTE las clases estáticas del mapa', (columns, clases) => {
    const { container } = render(<GridHomeBlockRenderer block={grid([ICONO], columns)} />);
    expect(container.querySelector('.grid')?.className).toBe(clases);
  });

  it('el código NO interpola clases de Tailwind', () => {
    // La otra mitad, y hace falta porque **el purgado es de tiempo de compilación**: ningún
    // test de render puede ver que una clase no llegó al CSS final —en jsdom el `className`
    // sale igual—. Lo único comprobable desde aquí es que la clase se escribe literal.
    // Se miran SÓLO las clases del JSX, no los comentarios: la cabecera del fichero explica
    // la regla escribiendo `sm:grid-cols-${n}` como ejemplo de lo que NO hacer, y contarlo
    // como infracción convertiría la documentación en un rojo.
    const codigo = readFileSync(join(__dirname, 'GridHomeBlockRenderer.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect(codigo.match(/(grid-cols|aspect|auto-rows)-\$\{/g)).toBeNull();
  });
});

describe('GridHomeBlockRenderer — lo que NO debía cambiar', () => {
  it('el icono de las señales de confianza se sigue pintando', () => {
    const { container } = render(
      <GridHomeBlockRenderer block={grid([{ ...ICONO, title: 'Anuncios moderados' }])} />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('Anuncios moderados')).toBeInTheDocument();
    // Y NO se estira al ancho como una imagen: cambiarle el tamaño habría cambiado la pinta
    // de una portada que lleva así desde RP.4.
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('h-8');
  });

  it('una imagen de origen AJENO degrada la tarjeta, no la borra', () => {
    // Criterio de RP.4: en una rejilla un hueco rompe la maquetación, así que la tarjeta
    // sigue ahí con su texto — al revés que el bloque `image` del blog, que desaparece.
    const { container } = render(
      <GridHomeBlockRenderer
        block={grid([{ media: { kind: 'image', url: AJENA, alt: 'x' }, title: 'Sigo aquí' }])}
      />,
    );
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByText('Sigo aquí')).toBeInTheDocument();
  });

  it('una tarjeta ANTIGUA sin media no revienta la portada', () => {
    // `media` es obligatorio desde el ajuste 6, pero endurecer el esquema no reescribe lo
    // guardado: una portada anterior puede traer celdas sin él. Si el renderizador diera por
    // hecho que existe, la portada entera dejaría de pintarse.
    const legacy = { title: 'Sin media' } as unknown as HomeGridCell;
    const { container } = render(<GridHomeBlockRenderer block={grid([legacy])} />);

    expect(screen.getByText('Sin media')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('sin href la tarjeta es un <div>; con href, un enlace', () => {
    const sinEnlace = render(<GridHomeBlockRenderer block={grid([ICONO])} />);
    expect(sinEnlace.container.querySelectorAll('a')).toHaveLength(0);

    render(<GridHomeBlockRenderer block={grid([{ ...ICONO, title: 'Ir', href: '/busqueda' }])} />);
    expect(screen.getByRole('link', { name: 'Ir' })).toHaveAttribute('href', '/busqueda');
  });
});
