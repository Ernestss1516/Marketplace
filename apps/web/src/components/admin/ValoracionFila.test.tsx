// 7a — LA BARRERA: la valoración se ve ENTERA en el backoffice.
//
// El defecto que cierra no era que faltara el dato: la API ya servía `comment`,
// `createdAt` y la contraparte de cada valoración. Las dos fichas se los CALLABAN —la de
// usuario pintaba estrellas y un nombre, la de anuncio ni la fecha—, así que un moderador
// no podía juzgar una valoración sin salir a otra pantalla.
//
// Se prueba el COMPONENTE, que es presentación pura, y no la ficha entera montada: las
// dos fichas son páginas con `useSession`, `useParams` y fetch, y lo que hay que fijar
// aquí son cuatro cadenas. El bloque final comprueba, sobre el fuente, que las dos las
// usan de verdad — molde de `etiquetas.test.ts` y de `backoffice-sections.test.ts`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { ValoracionFila } from './ValoracionFila';

const BASE = {
  rating: 4,
  comment: 'El vendedor no contestó tras el pago.',
  createdAt: '2026-03-14T10:30:00.000Z',
  persona: { id: 'usr_123', name: 'Marta' },
} as const;

function pintar(props: Partial<React.ComponentProps<typeof ValoracionFila>> = {}) {
  return render(
    <ul>
      <ValoracionFila {...BASE} relacion="recibida" {...props} />
    </ul>,
  );
}

describe('lo que la ficha se callaba', () => {
  it('EL COMENTARIO se ve', () => {
    // La mutación de este cuerpo: dejar sólo las estrellas. Cae aquí.
    pintar();
    expect(screen.getByText('El vendedor no contestó tras el pago.')).toBeInTheDocument();
  });

  it('LA FECHA se ve, en formato español', () => {
    pintar();
    expect(screen.getByText(/14\/03\/2026/)).toBeInTheDocument();
  });

  it('LA CONTRAPARTE se ve, y enlaza a SU ficha del backoffice', () => {
    // Al backoffice y no al perfil público: quien lee esto está moderando, y lo
    // siguiente que va a querer es la ficha de esa persona.
    pintar();
    const enlace = screen.getByRole('link', { name: 'Marta' });
    expect(enlace).toHaveAttribute('href', '/admin/usuarios/usr_123');
  });

  it('sin comentario no se pinta un párrafo vacío', () => {
    pintar({ comment: null });
    expect(screen.queryByText('El vendedor no contestó tras el pago.')).not.toBeInTheDocument();
  });
});

describe('la preposición dice de qué lado está la valoración', () => {
  // Se afirma sobre el texto del conjunto y no con `getByText`: la preposición y el
  // nombre son dos nodos (`<span>de <a>Marta</a></span>`), así que buscar «a» suelta
  // encuentra media fila. Lo que importa es cómo se LEE junto.
  it('recibida → «de» quien la escribió', () => {
    const { container } = pintar({ relacion: 'recibida' });
    expect(container.textContent).toContain('de Marta');
  });

  it('dada → «a» quien la recibió', () => {
    const { container } = pintar({ relacion: 'dada' });
    expect(container.textContent).toContain('a Marta');
    expect(container.textContent).not.toContain('de Marta');
  });
});

describe('las estrellas dicen cuántas de CINCO', () => {
  it('pinta las llenas y las vacías, sumando siempre cinco', () => {
    // `'★'.repeat(rating)` a secas obliga a contar puntas para saber si son tres de
    // cinco o tres de tres. Con las cinco siempre, no hay nada que contar.
    const { container } = pintar({ rating: 3 });
    const texto = container.textContent ?? '';
    expect(texto).toContain('★★★☆☆');
  });

  it('cinco de cinco no deja ninguna vacía', () => {
    const { container } = pintar({ rating: 5 });
    expect(container.textContent).toContain('★★★★★');
    expect(container.textContent).not.toContain('☆');
  });

  it('y el número exacto está en el `title`, para quien pase el ratón', () => {
    pintar({ rating: 2 });
    expect(screen.getByTitle('2 de 5')).toBeInTheDocument();
  });
});

// 7b — LA RETIRADA SE VE, y se distingue de una vigente sin leer el comentario.
//
// El staff NO excluye las retiradas (las excluye el público), así que la lista mezcla las
// dos. Si se pintaran idénticas, el moderador no sabría si el trabajo ya está hecho —y
// volvería a retirar una retirada, o restauraría creyendo que retira.
describe('7b — una valoración retirada se lee como retirada', () => {
  it('lleva el distintivo, el motivo y el comentario tachado', () => {
    const { container } = pintar({
      retiredAt: '2026-04-01T09:00:00.000Z',
      retiredReason: 'Insultos',
    });
    expect(screen.getByText('Retirada')).toBeInTheDocument();
    // El motivo EN CLARO, no sólo en el `title`: quien la va a restaurar tiene que
    // poder leer por qué la retiraron sin pasar el ratón por encima.
    expect(screen.getByText('Motivo: Insultos')).toBeInTheDocument();
    expect(container.querySelector('.line-through')).not.toBeNull();
  });

  it('una vigente no lleva nada de eso', () => {
    const { container } = pintar({ retiredAt: null });
    expect(screen.queryByText('Retirada')).not.toBeInTheDocument();
    expect(container.querySelector('.line-through')).toBeNull();
  });

  it('`verified: false` avisa de que esa valoración NO cuenta para la media', () => {
    // El dato que decide si retirarla cambia algo. `verified === false` explícito y no
    // `!verified`: sin el campo no se afirma nada.
    const { container } = pintar({ verified: false });
    expect(container.textContent).toContain('sin trato verificado');
  });

  it('sin el campo `verified` no se afirma nada (la ficha que aún no lo manda)', () => {
    const { container } = pintar();
    expect(container.textContent).not.toContain('sin trato verificado');
  });
});

describe('LA BARRERA — las DOS fichas usan esta fila', () => {
  // Se lee el fuente por el mismo motivo que en `etiquetas.test.ts`: montar dos páginas
  // con sesión y fetch para comprobar que importan un componente costaría más que el
  // cuerpo entero. Lo que fija es exacto: la forma vieja era `'★'.repeat(v.rating)`
  // escrito a mano en cada ficha, y revertir cualquiera de las dos la reintroduce.
  const ADMIN = join(__dirname, '..', '..', 'app', '(admin)', 'admin');
  const FICHA_USUARIO = readFileSync(join(ADMIN, 'usuarios', '[id]', 'page.tsx'), 'utf8');
  const FICHA_ANUNCIO = readFileSync(join(ADMIN, 'anuncios', '[id]', 'page.tsx'), 'utf8');

  it.each([
    ['usuario', FICHA_USUARIO],
    ['anuncio', FICHA_ANUNCIO],
  ])('la ficha de %s importa ValoracionFila y no pinta las estrellas a mano', (_cual, fuente) => {
    expect(fuente).toContain("import { ValoracionFila } from '@/components/admin/ValoracionFila'");
    expect(fuente).not.toContain("'★'.repeat(v.rating)");
  });

  it('las dos fichas se leen (red del propio test)', () => {
    expect(FICHA_USUARIO.length).toBeGreaterThan(1000);
    expect(FICHA_ANUNCIO.length).toBeGreaterThan(1000);
  });
});
