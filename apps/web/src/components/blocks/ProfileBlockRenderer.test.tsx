// ══ ESCAPARATE · LA FICHA COMO TARJETA DE CONTACTO — LO QUE LA CÁMARA NO PUEDE VER ══
//
// El reparto de barreras de esta ráfaga, dicho aquí porque es donde se nota la costura:
//
//  · las CAPTURAS (`e2e-snapshots/modelos-ficha.spec.ts`) vigilan que la ficha se REVISTA
//    —caja, radio, sombra, color, fuente— en los cinco modelos del catálogo;
//  · la INVARIANCIA (`e2e/estilo-invariancia.spec.ts`) vigila que ningún modelo la
//    REORGANICE;
//  · y esto vigila lo que ninguna de las dos puede: **la foto**.
//
// Porque el seed del escaparate no lleva ni una imagen, y no por descuido: «si falta, la
// captura fotografía un roto» (seed-playwright.ts §3.2). Así que la ficha sembrada —la
// que sale en las fotos— va sin foto, y el contrato de la foto (su texto alternativo, su
// caja reservada, su forma) se comprueba aquí, donde no hace falta que exista ningún
// objeto en MinIO para poder mirarlo.

import { render, screen } from '@testing-library/react';
import { ProfileBlockRenderer } from './ProfileBlockRenderer';
import type { ProfileBlock } from '@/types/blocks';

const FICHA: ProfileBlock = {
  id: 'f1',
  type: 'profile',
  image: { url: 'http://localhost:9000/marketplace-test/blocks/ana.jpg', alt: 'Ana García' },
  name: 'Ana García',
  attributes: [
    { label: 'Experiencia', value: '10 años' },
    { label: 'Zona', value: 'Madrid' },
  ],
};

/** La caja de la ficha. Un solo sitio del que sacarla, para que los tests no la busquen cada uno a su manera. */
function caja(): HTMLElement {
  return screen.getByTestId('bloque-ficha');
}

describe('ProfileBlockRenderer — aspecto de tarjeta de contacto', () => {
  // ── B1 · LA CAJA SE SEPARA DEL FONDO ──────────────────────────────────────────────
  // Las cuatro utilidades no son decoración intercambiable: son LO QUE HACE que la ficha
  // deje de parecer texto suelto. Y las cuatro son tokens, así que comprobarlas aquí es
  // además comprobar que el sabor lo pone el modelo (`rounded-2xl` = --radius × 2,
  // `bg-card`/`border`/`shadow-sm` = variables de globals.css) y no un valor cosido.
  it('la ficha se pinta dentro de una caja de tarjeta: fondo, borde, sombra y radio', () => {
    render(<ProfileBlockRenderer block={FICHA} />);
    for (const clase of ['bg-card', 'border', 'shadow-sm', 'rounded-2xl']) {
      expect(caja()).toHaveClass(clase);
    }
  });

  // ── B4 · LA FOTO: ACCESIBLE Y SIN CLS ─────────────────────────────────────────────
  it('la foto lleva su texto alternativo, es redonda y tiene la caja reservada antes de cargar', () => {
    render(<ProfileBlockRenderer block={FICHA} />);
    const foto = screen.getByRole('img', { name: 'Ana García' });

    expect(foto).toHaveAttribute('src', FICHA.image!.url);
    expect(foto).toHaveClass('rounded-full');
    // `width`/`height` explícitos: el navegador reserva 128×128 ANTES de tener la imagen,
    // así que la tarjeta no empuja el texto de abajo al cargar. Sin ellos, las clases
    // `h-32 w-32` llegan con el CSS y el hueco se abre tarde.
    expect(foto).toHaveAttribute('width', '128');
    expect(foto).toHaveAttribute('height', '128');
  });

  it('el texto alternativo es el que trae el bloque, no el nombre por su cuenta', () => {
    render(
      <ProfileBlockRenderer
        block={{ ...FICHA, image: { url: FICHA.image!.url, alt: 'Retrato de Ana en su taller' } }}
      />,
    );
    // Si alguien sustituyera `alt={block.image.alt}` por el nombre, este test cae: el
    // editor deja escribir un alt propio y esa elección tiene que llegar a la página.
    expect(screen.getByRole('img', { name: 'Retrato de Ana en su taller' })).toBeInTheDocument();
  });

  it('una foto de un dominio no autorizado no se pide: no se pinta ninguna imagen', () => {
    render(
      <ProfileBlockRenderer
        block={{ ...FICHA, image: { url: 'http://tercero.example/ana.jpg', alt: 'Ana' } }}
      />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    // …y la ficha sigue siendo una ficha: la caja no depende de la foto.
    expect(caja()).toBeInTheDocument();
    expect(screen.getByText('Ana García')).toBeInTheDocument();
  });

  // ── B5 · EL NOMBRE ES GRANDE DENTRO DE LA ESCALA, NO POR ENCIMA DE ELLA ───────────
  // «Grande» tenía dos maneras de conseguirse y sólo una es legítima. La escala
  // tipográfica es capa INVIOLABLE (docs/diseno-sistema-estilo.md §2, T3): se elige un
  // peldaño de los que ya existen. Un `text-[27px]` daría el mismo aspecto y rompería la
  // regla en silencio, así que esto rechaza cualquier valor arbitrario.
  it('el nombre usa un peldaño de la escala tipográfica, nunca un tamaño inventado', () => {
    render(<ProfileBlockRenderer block={FICHA} />);
    const nombre = screen.getByText('Ana García');
    const clases = nombre.className.split(/\s+/);

    const PELDANOS = ['text-lg', 'text-xl', 'text-2xl', 'text-3xl', 'text-4xl'];
    expect(clases.some((c) => PELDANOS.includes(c))).toBe(true);
    // Ni `text-[27px]` ni `text-[1.7rem]`: el corchete es la marca del valor a medida.
    expect(clases.some((c) => c.startsWith('text-['))).toBe(false);
    // Y se pinta más grande que los datos que tiene debajo, que es lo que «grande»
    // significa aquí: jerarquía, no píxeles.
    expect(nombre).toHaveClass('text-2xl');
  });

  // ── B1 · LOS DATOS, ORDENADOS Y COMPLETOS ────────────────────────────────────────
  it('cada atributo se pinta como etiqueta + valor, en el orden en que viene', () => {
    render(<ProfileBlockRenderer block={FICHA} />);

    const etiquetas = Array.from(caja().querySelectorAll('dt')).map((dt) => dt.textContent);
    const valores = Array.from(caja().querySelectorAll('dd')).map((dd) => dd.textContent);

    expect(etiquetas).toEqual(['Experiencia', 'Zona']);
    expect(valores).toEqual(['10 años', 'Madrid']);
  });

  it('un valor largo se parte en varias líneas en vez de cortarse', () => {
    render(
      <ProfileBlockRenderer
        block={{ ...FICHA, attributes: [{ label: 'Correo', value: 'ana.garcia.taller@ejemplo.com' }] }}
      />,
    );
    const valor = screen.getByText('ana.garcia.taller@ejemplo.com');
    // El dato por el que existe una tarjeta de contacto no puede llegar cortado: `truncate`
    // —lo que había antes— se comía la mitad de cualquier correo.
    expect(valor).toHaveClass('break-words');
    expect(valor).not.toHaveClass('truncate');
  });

  // ── LO QUE DECIDE QUÉ SE PINTA SON LOS DATOS, NO EL MODELO ───────────────────────
  // Los tres campos son opcionales en el esquema. Que la ficha aguante sin ellos importa
  // para la frontera: lo que aparece y desaparece es el CONTENIDO, y el contenido es el
  // mismo para los cinco modelos.
  it('sin atributos no cuelga un filete de una lista vacía', () => {
    render(<ProfileBlockRenderer block={{ ...FICHA, attributes: [] }} />);
    expect(caja().querySelector('dl')).toBeNull();
    expect(screen.getByText('Ana García')).toBeInTheDocument();
  });

  it('sin foto y sin nombre sigue siendo una tarjeta con sus datos', () => {
    render(<ProfileBlockRenderer block={{ ...FICHA, image: undefined, name: undefined }} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(caja()).toHaveClass('bg-card');
    expect(screen.getByText('10 años')).toBeInTheDocument();
  });
});
