import * as React from 'react';
import { render } from '@testing-library/react';
import { Zona } from './zona';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';

/**
 * ══ RESIDUO 1 · EL INVENTARIO COMPLETO, EN UN SITIO ══════════════════════════════════
 *
 * POR QUÉ ESTE TEST EXISTE ADEMÁS DE LOS DE PLAYWRIGHT. Los de navegador miden lo que
 * de verdad importa —que el overlay COMPUTA los tokens de su zona—, pero sólo pueden
 * medirlo donde ese overlay se usa hoy, y hoy el backoffice no monta ni un
 * `dropdown-menu`. Esto cubre el otro filo de la barrera: que los CUATRO genéricos
 * declaran la zona, se usen donde se usen. Un quinto que se añadiera sin ella cae aquí
 * sin depender de que alguien lo abra en una pantalla.
 *
 * Y comprueba de paso POR QUÉ hace falta el arreglo: que el nodo portalado no cuelga del
 * div de la zona. Si algún día Radix dejara de portalear, ese control se pondría rojo y
 * el atributo pasaría a ser redundante — que es información, no ruido.
 */

/**
 * Tres carencias de jsdom que el `Select` de Radix necesita, y que no tienen nada que ver
 * con lo que se prueba aquí: sin layout no hay captura de puntero ni observador de
 * tamaño. Se rellenan en este fichero y no en `jest.setup.ts` porque es el único que abre
 * un `Select`.
 */
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!global.ResizeObserver) {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

/**
 * Los cuatro genéricos, cada uno abierto.
 *
 * `nodos` es cuántos elementos portalea cada uno: los dos diálogos montan velo +
 * contenido, y Radix da a cada uno su propio envoltorio en `<body>` —el velo no cuelga
 * del contenido, así que no heredaría su zona y necesita la suya—. El menú y el selector
 * montan una sola capa.
 */
const OVERLAYS = [
  {
    nombre: 'dialog',
    nodos: 2,
    texto: 'Cuerpo del diálogo',
    abierto: (
      <Dialog open>
        <DialogContent>
          <DialogTitle>Título</DialogTitle>
          <DialogDescription>Cuerpo del diálogo</DialogDescription>
        </DialogContent>
      </Dialog>
    ),
  },
  {
    nombre: 'alert-dialog',
    nodos: 2,
    texto: 'Cuerpo del aviso',
    abierto: (
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Título</AlertDialogTitle>
          <AlertDialogDescription>Cuerpo del aviso</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>
    ),
  },
  {
    nombre: 'dropdown-menu',
    nodos: 1,
    texto: 'Una opción del menú',
    abierto: (
      <DropdownMenu open>
        <DropdownMenuTrigger>Abrir</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Una opción del menú</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
  {
    nombre: 'select',
    nodos: 1,
    texto: 'Una opción del selector',
    abierto: (
      <Select open>
        <SelectTrigger>Elegir</SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Una opción del selector</SelectItem>
        </SelectContent>
      </Select>
    ),
  },
];

/** Lo que lleva esa zona en el documento SIN colgar del div de la zona: o sea, lo portalado. */
function portaladosConZona(zona: string, divDeZona: HTMLElement) {
  return Array.from(document.querySelectorAll(`[data-zona="${zona}"]`)).filter(
    (el) => el !== divDeZona && !divDeZona.contains(el),
  );
}

describe('Los overlays genéricos declaran la zona desde la que se abren', () => {
  it.each(OVERLAYS)(
    '«$nombre»: se monta fuera del subárbol de la zona, y sus $nodos nodo(s) la declaran',
    ({ nodos, texto, abierto }) => {
      const { container } = render(<Zona nombre="backoffice">{abierto}</Zona>);
      const divDeZona = container.querySelector('[data-zona="backoffice"]') as HTMLElement;

      // Está montado de verdad: sin esto, cero nodos portalados pasaría por «correcto».
      expect(document.body.textContent).toContain(texto);
      // Y no cuelga del div de la zona — que es exactamente lo que rompía la herencia.
      expect(divDeZona.querySelectorAll('[data-zona]')).toHaveLength(0);
      // Así que la zona tiene que venir escrita en el propio nodo portalado.
      expect(portaladosConZona('backoffice', divDeZona)).toHaveLength(nodos);
    },
  );

  /**
   * EL CONTROL NEGATIVO, y no es simetría decorativa: `public` es la BASE del modelo y no
   * tiene bloque propio, así que lo correcto fuera de las cuatro zonas es NO escribir el
   * atributo. Un `data-zona="public"` casaría con un bloque que no existe.
   */
  it.each(OVERLAYS)('«$nombre» fuera de toda zona no se inventa ninguna', ({ abierto }) => {
    render(<div>{abierto}</div>);
    expect(document.querySelectorAll('[data-zona]')).toHaveLength(0);
  });

  /**
   * La zona de un overlay es la de DONDE SE ABRIÓ, no la del documento: dos zonas en la
   * misma página entregan cada una la suya. Es justo el caso que un mecanismo «de
   * documento» (`:root:has([data-zona="x"])`, la vía descartada) no sabría distinguir.
   */
  it('dos zonas a la vez: cada overlay se lleva la suya', () => {
    render(
      <>
        <Zona nombre="backoffice">
          <Dialog open>
            <DialogContent>
              <DialogTitle>Del backoffice</DialogTitle>
              <DialogDescription>d</DialogDescription>
            </DialogContent>
          </Dialog>
        </Zona>
        <Zona nombre="blog">
          <DropdownMenu open>
            <DropdownMenuTrigger>Abrir</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Del blog</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Zona>
      </>,
    );

    expect(document.querySelector('[role="dialog"]')?.getAttribute('data-zona')).toBe('backoffice');
    expect(document.querySelector('[role="menu"]')?.getAttribute('data-zona')).toBe('blog');
  });
});

describe('<Zona> declara el atributo y el contexto de una sola vez', () => {
  it('una prop suelta no puede dejar el subárbol en una zona y sus diálogos en otra', () => {
    // Se escribe con un `as` porque en TypeScript esto ya no compila: `data-zona` no está
    // en las props de `<Zona>`. Lo que se comprueba aquí es la otra mitad —que en tiempo
    // de ejecución tampoco cuela—, porque el atributo y el contexto salen de `nombre` y
    // desincronizarlos sería pintar la zona en un sitio y sus capas en otro.
    const props = {
      nombre: 'backoffice',
      'data-zona': 'blog',
    } as React.ComponentProps<typeof Zona>;

    const { container } = render(
      <Zona {...props}>
        <Dialog open>
          <DialogContent>
            <DialogTitle>t</DialogTitle>
            <DialogDescription>d</DialogDescription>
          </DialogContent>
        </Dialog>
      </Zona>,
    );

    expect(container.firstElementChild?.getAttribute('data-zona')).toBe('backoffice');
    expect(document.querySelector('[role="dialog"]')?.getAttribute('data-zona')).toBe('backoffice');
  });
});
