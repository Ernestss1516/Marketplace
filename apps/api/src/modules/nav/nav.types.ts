import { NavItemType, PostStatus } from '@prisma/client';
import type { NavPageType } from '@prisma/client';

/**
 * Profundidad máxima del árbol de navegación: raíz (barra) + un nivel de hijos
 * (desplegable). El modelo (NavItem.parentId auto-referencial) soporta N
 * niveles; el tope es POLÍTICA validada en el servicio, no una restricción de
 * schema — mismo criterio que el árbol de categorías, cuyo tope de 2 niveles
 * vive en AdminService.assertParentIsRoot y no en Category.
 *
 * Subirlo a 3 es cambiar este número y hacer el trabajo de render; bajarlo
 * obligaría a migrar datos. Por eso se empieza acotado.
 */
export const NAV_MAX_DEPTH = 2;

/**
 * Nodo del árbol tal como sale de la BD, con lo mínimo que la poda necesita.
 * Se declara aparte del tipo que genera Prisma para que `pruneNavTree` sea una
 * función pura testeable sin BD ni stubs (molde: los resolvers de
 * category.types.ts).
 */
export interface NavItemNode {
  label: string;
  order: number;
  active: boolean;
  type: NavItemType | null;
  url: string | null;
  /** Solo relevante si type=PAGE. null si el ítem no apunta a ninguna página. */
  page: { slug: string; status: PostStatus } | null;
  visibleOn: NavPageType[];
  children: NavItemNode[];
}

/**
 * Nodo YA RESUELTO que viaja al frontend: href calculado server-side y árbol
 * podado. El frontend solo mapea — no reimplementa la semántica de los tipos de
 * destino, igual que con el footer (ver FooterService.listPublicNav).
 */
export interface NavNode {
  label: string;
  /** null = nodo solo-desplegable: no navega, únicamente abre sus hijos. */
  href: string | null;
  /** true → el enlace se abre en pestaña nueva (target="_blank"). */
  external: boolean;
  /** [] en las hojas. */
  children: NavNode[];
}

/**
 * Resuelve el destino de un nodo a un href, o null si no lleva a ningún sitio.
 *
 * Un destino type=PAGE solo cuenta si su página está PUBLISHED — mismo criterio
 * que el footer (FooterService.listPublicNav filtra los ítems PAGE por
 * status=PUBLISHED). La diferencia es qué se hace con el resultado: en el
 * footer el ítem desaparece; aquí un nodo con la página en borrador PERO con
 * hijos visibles sobrevive como solo-desplegable, porque sigue abriendo algo.
 */
function resolveHref(node: NavItemNode): string | null {
  switch (node.type) {
    case NavItemType.PAGE:
      return node.page?.status === PostStatus.PUBLISHED ? `/paginas/${node.page.slug}` : null;
    case NavItemType.INTERNAL:
    case NavItemType.EXTERNAL:
      return node.url;
    default:
      // type === null → nodo sin destino (solo-desplegable).
      return null;
  }
}

/**
 * Poda un nodo y su subárbol para un tipo de página concreto. Post-orden: los
 * hijos se resuelven ANTES de decidir si el padre sobrevive, que es lo que hace
 * que el gate sea recursivo de verdad.
 *
 * Devuelve null cuando el nodo no debe mostrarse. Un nodo se muestra si y solo
 * si se cumplen las tres:
 *   1. active === true;
 *   2. visibleOn está vacío (sin filtro) o incluye el tipo de página actual;
 *   3. tiene destino visible O al menos un hijo visible tras podar.
 *
 * De (3) sale lo que de verdad importa: un desplegable cuyos hijos quedaron
 * todos ocultos se oculta él también — nunca queda un botón que abre un menú
 * vacío. Es también lo que oculta un nodo recién creado sin destino ni hijos,
 * que el servicio acepta a propósito al escribir (ver diseño §2.3).
 */
function pruneNode(node: NavItemNode, pageType: NavPageType): NavNode | null {
  // 1. Un nodo inactivo se lleva su subárbol entero: los hijos NO se evalúan ni
  //    se promocionan a la raíz.
  if (!node.active) return null;

  // 2. visibleOn vacío = "sin filtro", NO "en ninguna" (ver NavItem.visibleOn).
  if (node.visibleOn.length > 0 && !node.visibleOn.includes(pageType)) return null;

  // 3. Los hijos PRIMERO — sin esto el paso 5 decidiría con información vieja.
  const children = node.children
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((child) => pruneNode(child, pageType))
    .filter((child): child is NavNode => child !== null);

  const href = resolveHref(node);

  // 5. EL GATE: ni lleva a ningún sitio ni abre nada.
  if (href === null && children.length === 0) return null;

  return {
    label: node.label,
    href,
    external: node.type === NavItemType.EXTERNAL,
    children,
  };
}

/**
 * Poda el árbol completo para un tipo de página. Un array vacío significa que
 * la barra NO debe renderizarse en absoluto (gate total) — a diferencia del
 * footer, que conserva su copyright aunque no haya ninguna columna visible.
 *
 * Función pura: no toca BD ni servicios, así que el gate se prueba sobre
 * estructuras en memoria (molde: los resolvers de category.types.ts y su spec).
 */
export function pruneNavTree(roots: NavItemNode[], pageType: NavPageType): NavNode[] {
  return roots
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((root) => pruneNode(root, pageType))
    .filter((node): node is NavNode => node !== null);
}
