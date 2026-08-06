import { NavItemType, NavPageType, PostStatus } from '@prisma/client';
import { pruneNavTree, type NavItemNode } from './nav.types';

/**
 * Tests del GATE RECURSIVO (diseño §5) — el único algoritmo de este mini-hito
 * sin molde en el repo, y por eso el que más cobertura lleva.
 *
 * `pruneNavTree` es una función PURA sobre el árbol ya cargado, así que estos
 * tests no tocan BD ni stubs de Prisma: construyen la estructura en memoria y
 * comprueban qué sobrevive. Mismo planteamiento que category.types.spec.ts con
 * sus resolvers.
 *
 * La tabla de casos del §5.3 del diseño está cubierta test a test, en orden.
 */

// ─── Constructores de nodos (defaults: visible y sin filtro) ────────────────

function node(overrides: Partial<NavItemNode> & { label: string }): NavItemNode {
  return {
    order: 0,
    active: true,
    type: null,
    url: null,
    page: null,
    visibleOn: [],
    children: [],
    ...overrides,
  };
}

/** Nodo con destino INTERNAL — el destino válido más simple posible. */
function link(label: string, overrides: Partial<NavItemNode> = {}): NavItemNode {
  return node({ label, type: NavItemType.INTERNAL, url: `/${label.toLowerCase()}`, ...overrides });
}

/** Nodo SIN destino: solo sirve si tiene hijos visibles. */
function dropdown(label: string, children: NavItemNode[], overrides: Partial<NavItemNode> = {}): NavItemNode {
  return node({ label, type: null, children, ...overrides });
}

/** Nodo con destino PAGE, con el status de la página enlazada. */
function pageLink(label: string, status: PostStatus, overrides: Partial<NavItemNode> = {}): NavItemNode {
  return node({
    label,
    type: NavItemType.PAGE,
    page: { slug: label.toLowerCase(), status },
    ...overrides,
  });
}

const ALL_PAGE_TYPES = Object.values(NavPageType);

describe('pruneNavTree — gate recursivo', () => {
  // Caso 1 de la tabla §5.3
  it('nodo con destino, sin hijos, activo y visibleOn=[] → visible en LAS 9 páginas', () => {
    const tree = [link('Ayuda')];

    for (const pageType of ALL_PAGE_TYPES) {
      const result = pruneNavTree(tree, pageType);
      expect(result).toEqual([{ label: 'Ayuda', href: '/ayuda', external: false, children: [] }]);
    }
    // Guarda de que el enum no se quedó corto respecto al diseño.
    expect(ALL_PAGE_TYPES).toHaveLength(9);
  });

  // Caso 2
  it('nodo con visibleOn=[HOME] → visible en HOME, oculto en BUSQUEDA', () => {
    const tree = [link('Novedades', { visibleOn: [NavPageType.HOME] })];

    expect(pruneNavTree(tree, NavPageType.HOME)).toHaveLength(1);
    expect(pruneNavTree(tree, NavPageType.BUSQUEDA)).toEqual([]);
  });

  // Caso 3
  it('padre sin destino con 2 hijos, uno inactivo → visible con 1 hijo', () => {
    const tree = [
      dropdown('Ayuda', [
        link('Contacto', { order: 0 }),
        link('Soporte', { order: 1, active: false }),
      ]),
    ];

    expect(pruneNavTree(tree, NavPageType.HOME)).toEqual([
      {
        label: 'Ayuda',
        href: null,
        external: false,
        children: [{ label: 'Contacto', href: '/contacto', external: false, children: [] }],
      },
    ]);
  });

  // Caso 4 — EL caso recursivo clave.
  it('padre sin destino con TODOS los hijos ocultos por visibleOn → se oculta él también', () => {
    const tree = [
      dropdown('Ayuda', [
        link('Contacto', { visibleOn: [NavPageType.HOME] }),
        link('Soporte', { visibleOn: [NavPageType.HOME] }),
      ]),
    ];

    // En HOME los hijos pasan y el padre sobrevive…
    expect(pruneNavTree(tree, NavPageType.HOME)).toHaveLength(1);
    // …pero en BUSQUEDA no queda nada que desplegar: el padre desaparece
    // aunque su propio visibleOn no lo excluía.
    expect(pruneNavTree(tree, NavPageType.BUSQUEDA)).toEqual([]);
  });

  // Caso 5
  it('padre CON destino y todos los hijos ocultos → visible como enlace simple, sin desplegable', () => {
    const tree = [
      link('Ayuda', {
        children: [link('Contacto', { active: false }), link('Soporte', { active: false })],
      }),
    ];

    expect(pruneNavTree(tree, NavPageType.HOME)).toEqual([
      { label: 'Ayuda', href: '/ayuda', external: false, children: [] },
    ]);
  });

  // Caso 6
  it('padre inactivo con un hijo activo → padre e hijo ocultos (el corte es de subárbol)', () => {
    const tree = [dropdown('Ayuda', [link('Contacto')], { active: false })];

    // El hijo NO se promociona a raíz.
    expect(pruneNavTree(tree, NavPageType.HOME)).toEqual([]);
  });

  // Caso 7
  it('nodo type=PAGE cuya página está en DRAFT, sin hijos → oculto', () => {
    const tree = [pageLink('Legal', PostStatus.DRAFT)];

    expect(pruneNavTree(tree, NavPageType.HOME)).toEqual([]);
  });

  // Caso 8
  it('nodo type=PAGE en DRAFT PERO con un hijo visible → visible como solo-desplegable (href=null)', () => {
    const tree = [pageLink('Legal', PostStatus.DRAFT, { children: [link('Privacidad')] })];

    expect(pruneNavTree(tree, NavPageType.HOME)).toEqual([
      {
        label: 'Legal',
        href: null, // el destino no cuenta, pero el nodo sigue abriendo algo
        external: false,
        children: [{ label: 'Privacidad', href: '/privacidad', external: false, children: [] }],
      },
    ]);
  });

  // Caso 9
  it('nodo sin destino recién creado, sin hijos todavía → oculto (aceptado al escribir, podado al leer)', () => {
    const tree = [dropdown('Menú nuevo', [])];

    expect(pruneNavTree(tree, NavPageType.HOME)).toEqual([]);
  });

  // Caso 10
  it('todos los nodos ocultos → [] (la barra no se renderiza)', () => {
    const tree = [
      link('Inactivo', { active: false }),
      pageLink('Borrador', PostStatus.DRAFT),
      dropdown('Vacío', []),
      link('Otra página', { visibleOn: [NavPageType.PLANES] }),
    ];

    expect(pruneNavTree(tree, NavPageType.HOME)).toEqual([]);
  });
});

describe('pruneNavTree — resolución de href y orden', () => {
  it('resuelve cada tipo de destino server-side (PAGE→/paginas/{slug}, INTERNAL/EXTERNAL→url)', () => {
    const tree = [
      pageLink('Legal', PostStatus.PUBLISHED, { order: 0 }),
      node({ label: 'Buscar', order: 1, type: NavItemType.INTERNAL, url: '/busqueda' }),
      node({ label: 'Blog externo', order: 2, type: NavItemType.EXTERNAL, url: 'https://example.com' }),
    ];

    expect(pruneNavTree(tree, NavPageType.HOME)).toEqual([
      { label: 'Legal', href: '/paginas/legal', external: false, children: [] },
      { label: 'Buscar', href: '/busqueda', external: false, children: [] },
      { label: 'Blog externo', href: 'https://example.com', external: true, children: [] },
    ]);
  });

  it('ordena por `order` ascendente en los dos niveles, no por el orden de llegada', () => {
    const tree = [
      dropdown('Segundo', [link('B', { order: 5 }), link('A', { order: 1 })], { order: 20 }),
      link('Primero', { order: 10 }),
    ];

    const result = pruneNavTree(tree, NavPageType.HOME);

    expect(result.map((n) => n.label)).toEqual(['Primero', 'Segundo']);
    expect(result[1].children.map((n) => n.label)).toEqual(['A', 'B']);
  });

  it('no muta el árbol de entrada al ordenar', () => {
    const children = [link('B', { order: 5 }), link('A', { order: 1 })];
    const tree = [dropdown('Menú', children, { order: 20 }), link('Otro', { order: 10 })];

    pruneNavTree(tree, NavPageType.HOME);

    expect(tree.map((n) => n.label)).toEqual(['Menú', 'Otro']);
    expect(children.map((n) => n.label)).toEqual(['B', 'A']);
  });
});

describe('pruneNavTree — poda de abajo arriba en 2 niveles', () => {
  it('poda hojas, luego los padres que quedaron vacíos, y deja en pie lo que sí sobrevive', () => {
    const tree = [
      // Sobrevive: uno de sus dos hijos pasa el filtro.
      dropdown(
        'Mixto',
        [
          link('Solo home', { order: 0, visibleOn: [NavPageType.HOME] }),
          link('Siempre', { order: 1 }),
        ],
        { order: 0 },
      ),
      // Muere: sus dos hijos se van y él no tiene destino propio.
      dropdown(
        'Se vacía',
        [
          link('Solo home 2', { order: 0, visibleOn: [NavPageType.HOME] }),
          pageLink('Borrador', PostStatus.DRAFT, { order: 1 }),
        ],
        { order: 1 },
      ),
      // Sobrevive por destino propio pese a perder a todos sus hijos.
      link('Con destino', {
        order: 2,
        url: '/con-destino',
        children: [link('Solo home 3', { visibleOn: [NavPageType.HOME] })],
      }),
    ];

    const result = pruneNavTree(tree, NavPageType.ANUNCIO);

    expect(result).toEqual([
      {
        label: 'Mixto',
        href: null,
        external: false,
        children: [{ label: 'Siempre', href: '/siempre', external: false, children: [] }],
      },
      { label: 'Con destino', href: '/con-destino', external: false, children: [] },
    ]);
  });
});
