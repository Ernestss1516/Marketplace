import {
  BarChart3,
  Bell,
  Coins,
  CreditCard,
  Crown,
  Heart,
  LifeBuoy,
  List,
  MessageSquare,
  PlusCircle,
  Receipt,
  Search,
  User,
  type LucideIcon,
} from 'lucide-react';

/**
 * UXV.2 — FUENTE ÚNICA de la navegación de la zona de cuenta.
 *
 * La consumen tres cosas que antes no existían o no se hablaban: el `<aside>` de
 * escritorio, el drawer de móvil y las migas de pan. Que las tres salgan de aquí es lo
 * que impide que el menú diga una cosa y las migas otra.
 *
 * ANTES: nueve `<Link>` planos incrustados en el layout, sin estado activo y sin cuatro
 * de los destinos de la propia zona (Estadísticas, Datos de facturación, Mis tickets y
 * Planes solo se alcanzaban desde un botón enterrado en otra pantalla — M2).
 */

export interface AccountNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Ruta “raíz de sección”: solo se marca activa con coincidencia EXACTA, nunca por
   * prefijo. Sin esto, `/mis-anuncios` se quedaría marcado estando en
   * `/mis-anuncios/estadisticas`, que es una entrada distinta del mismo grupo. Mismo
   * caso especial que resuelve `AdminNav` con `/admin`.
   */
  exact?: boolean;
  /** Sale de `(account)`: el shell cambia y hay que poder volver (SHELL-D3). */
  external?: boolean;
}

export interface AccountNavGroup {
  title: string;
  items: AccountNavItem[];
}

/**
 * SHELL-D4 — agrupadas por la TAREA del vendedor, no por la forma de la URL (por eso
 * «Datos de facturación», que cuelga de `/perfil`, vive con los pagos y no con el
 * perfil). Trece entradas planas no son navegación; agrupadas se leen de un vistazo.
 */
export const ACCOUNT_NAV: AccountNavGroup[] = [
  {
    title: 'Vender',
    items: [
      { href: '/mis-anuncios', label: 'Mis anuncios', icon: List, exact: true },
      { href: '/publicar', label: 'Publicar anuncio', icon: PlusCircle },
      { href: '/mis-anuncios/estadisticas', label: 'Estadísticas', icon: BarChart3 },
    ],
  },
  {
    title: 'Comunicación',
    items: [
      { href: '/mensajes', label: 'Mensajes', icon: MessageSquare },
      { href: '/notificaciones', label: 'Notificaciones', icon: Bell },
      { href: '/mis-alertas', label: 'Mis alertas', icon: Search },
      { href: '/favoritos', label: 'Favoritos', icon: Heart },
    ],
  },
  {
    title: 'Cuenta y pagos',
    items: [
      { href: '/mis-creditos', label: 'Mi saldo', icon: Coins },
      { href: '/perfil/suscripcion', label: 'Mi suscripción', icon: Crown },
      // SHELL-D3: /planes se queda en (public) — es página de captación y tiene que
      // seguir siendo visitable sin sesión. Entra en el menú para que deje de ser
      // inalcanzable (M2), marcada como `external` porque al pisarla cambia el shell.
      { href: '/planes', label: 'Ver planes', icon: CreditCard, external: true },
      { href: '/perfil/facturacion', label: 'Datos de facturación', icon: Receipt },
      { href: '/perfil', label: 'Mi perfil', icon: User, exact: true },
    ],
  },
  {
    title: 'Ayuda',
    items: [{ href: '/mis-tickets', label: 'Mis tickets', icon: LifeBuoy }],
  },
];

/** Todas las entradas en una lista plana — para resolver la ruta activa y las migas. */
const ALL_ITEMS: AccountNavItem[] = ACCOUNT_NAV.flatMap((g) => g.items);

/**
 * ¿Esta entrada corresponde a la ruta actual?
 *
 * Molde de [`AdminNav`](../app/(admin)/components/AdminNav.tsx): `startsWith`, con
 * coincidencia exacta para las raíces de sección. Se reusa el CRITERIO, no el fichero —
 * aquel resuelve roles y vive en el árbol del backoffice.
 */
export function isAccountItemActive(item: AccountNavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

/**
 * La entrada del menú a la que pertenece la ruta actual, o null si ninguna la cubre.
 * Se prefiere SIEMPRE la coincidencia más larga: `/mis-anuncios/estadisticas` pertenece
 * a Estadísticas, no a Mis anuncios, aunque las dos casen por prefijo.
 */
export function findAccountNavItem(pathname: string): AccountNavItem | null {
  return (
    ALL_ITEMS.filter((item) => isAccountItemActive(item, pathname)).sort(
      (a, b) => b.href.length - a.href.length,
    )[0] ?? null
  );
}

export interface Crumb {
  name: string;
  /** Sin href = eslabón final (dónde estás), no navegable. */
  href?: string;
}

/**
 * Sufijos de las pantallas de tercer nivel: las que cuelgan de una entrada del menú y
 * no tienen entrada propia. La clave es el resto del pathname tras el href de su
 * sección, con los segmentos dinámicos (ids) normalizados a `:id`.
 *
 * Vive aquí y no en cada página a propósito: las migas son ORIENTACIÓN, que es trabajo
 * del shell. Repartirlas por veinte páginas las condenaría a divergir del menú, que es
 * exactamente el defecto que esta tanda cierra.
 */
const LEAF_LABELS: Record<string, string> = {
  '/mis-anuncios/:id/editar': 'Editar anuncio',
  '/mis-anuncios/destacado-exito': 'Destacado en proceso',
  '/mis-anuncios/destacado-error': 'Pago no completado',
  '/mis-creditos/exito': 'Compra',
  '/mis-creditos/error': 'Pago no completado',
  '/mensajes/:id': 'Conversación',
  '/mis-tickets/nuevo': 'Nuevo ticket',
  '/mis-tickets/:id': 'Ticket',
};

/**
 * ¿Este segmento es un id y no un tramo de ruta escrito a mano?
 *
 * Los ids del proyecto son `cuid` (Prisma) — 20+ caracteres alfanuméricos sin guiones —
 * más los uuid que aparecen en algún sitio. Se reconoce la FORMA en vez de mantener una
 * lista de rutas dinámicas: una ruta nueva con `[id]` funciona sin tocar esto, y ningún
 * tramo escrito a mano de esta zona (`editar`, `estadisticas`, `destacado-exito`…) cae
 * en el patrón.
 */
function isDynamicSegment(segment: string): boolean {
  const numeric = /^\d+$/;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const cuid = /^[a-z0-9]{20,}$/i;
  return numeric.test(segment) || uuid.test(segment) || cuid.test(segment);
}

/** Normaliza los ids del pathname para poder buscarlo en `LEAF_LABELS`. */
function normalize(pathname: string): string {
  const segments = pathname
    .split('/')
    .filter(Boolean)
    .map((s) => (isDynamicSegment(s) ? ':id' : s));
  return '/' + segments.join('/');
}

/**
 * Migas de la ruta actual: Inicio › [sección] › [pantalla], derivadas del pathname.
 *
 * Devuelve `[]` para las raíces de sección: en `/mis-anuncios` la miga sería «Inicio /
 * Mis anuncios» con el menú ya marcando «Mis anuncios» — ruido, no orientación. Las
 * migas aparecen cuando hay algo que el menú no puede contar: que estás DENTRO de una
 * sección.
 */
export function resolveAccountTrail(pathname: string): Crumb[] {
  const section = findAccountNavItem(pathname);
  if (!section) return [];

  const normalized = normalize(pathname);
  if (normalized === section.href) return [];

  const leaf = LEAF_LABELS[normalized];
  return [
    { name: section.label, href: section.href },
    { name: leaf ?? section.label },
  ];
}
