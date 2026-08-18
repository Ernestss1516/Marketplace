import { atLeast, type Role } from './roles';

/**
 * ROLES — RÁFAGA 1. **LA FUENTE ÚNICA DE VERDAD DEL BACKOFFICE.**
 *
 * QUÉ DEFECTO CIERRA. El acceso a `/admin/*` se decidía en TRES listas mantenidas
 * a mano que podían divergir —y divergían—:
 *
 *   1. `ROLE_ALLOWED_PATHS` en `middleware.ts` — qué rutas ve cada rol.
 *   2. `NAV_ITEMS` en `AdminNav.tsx` — qué ítems ve cada rol, con su etiqueta y su orden.
 *   3. los `@Roles`/`@MinRole` de los 16 controladores del api.
 *
 * El comentario del propio middleware admitía el acoplamiento: «sin el path la
 * sección es inaccesible; sin el ítem del nav, invisible». Y la divergencia estaba
 * ahí, materializada: `/admin/motivos-contacto` existe, es alcanzable y **no
 * aparecía en el nav** porque alguien añadió la ruta y olvidó la segunda lista.
 *
 * Las listas 1 y 2 DESAPARECEN: middleware y nav derivan de este fichero. La 3 se
 * queda donde está —y sigue siendo la autorización REAL— por una razón verificada
 * que no es negociable: **sección y endpoint no son 1:1**. `/admin/usuarios` es UNA
 * sección servida por OCHO endpoints con dos pisos distintos (listar es MODERATOR,
 * banear es ADMIN); `/admin/blog` y `/admin/paginas` son DOS secciones servidas por
 * UN controlador. Derivar los `@Roles` de este mapa exigiría aplanar esa
 * granularidad, que es justo la que M4 diseñó a propósito. Ver
 * docs/diseno-roles.md §2.2.
 *
 * Molde: `config/account-nav.ts` (UXV.2), la fuente única de la zona de cuenta.
 *
 * ─── INVENTARIO CONGELADO (ráfaga 1 de 3) ──────────────────────────────────────
 *
 * Este mapa reproduce EXACTAMENTE el acceso que había antes del refactor, rol por
 * rol y sección por sección. Esta ráfaga cambia CÓMO se decide el acceso, no QUÉ
 * acceso hay: cuentas resultantes ADMIN 21 / MODERATOR 7 / EDITOR 2 ítems de nav,
 * las mismas que pinzan los tres tests de `admin-roles.spec.ts`, que NO se han
 * tocado. El reparto nuevo que quiere Ernest (EDITOR 7 / MODERATOR 19 / ADMIN 22)
 * es la RÁFAGA 2, y se hará cambiando los `minRole` de este fichero y los
 * `@MinRole` de los controladores — encima de un mecanismo ya probado.
 */

export interface BackofficeSection {
  /**
   * Clave estable, INDEPENDIENTE de la ruta. Es lo que permite que los tests y (en
   * el futuro) el api hablen de la misma sección sin conocer las rutas de Next.
   */
  id: string;
  /** Prefijo de ruta. La coincidencia es por SEGMENTO, nunca por prefijo — ver `sectionForPath`. */
  route: string;
  /** Texto del ítem en la barra lateral. */
  label: string;
  /** El piso de la escalera: este rol o superior. */
  minRole: Role;
  /**
   * Ruta «raíz de sección»: casa SOLO con coincidencia exacta, nunca con sus
   * subrutas. Lo necesita `/admin` (el dashboard), que además de ser una sección
   * es la raíz de todas las demás: sin esto se tragaría cualquier `/admin/loquesea`
   * y le prestaría su piso — incluidas las rutas que no existen, que dejarían de
   * ser fail-closed.
   *
   * Mismo caso especial y mismo nombre que `exact` en `config/account-nav.ts`, que
   * ya lo documenta para `/mis-anuncios`. Aquí gobierna DOS cosas a la vez: a qué
   * sección pertenece una ruta y qué ítem del nav se marca activo — que antes eran
   * dos reglas escritas por separado.
   */
  exact?: boolean;
  /**
   * ANOMALÍA DECLARADA, no una opción de diseño. Hoy `/admin/motivos-contacto` es
   * alcanzable por un ADMIN y no figura en el nav — es el hallazgo R3 de la
   * auditoría. El inventario está congelado en esta ráfaga, así que la anomalía se
   * conserva; lo que cambia es que ahora está **declarada en un sitio** en vez de
   * ser la ausencia de una fila en una segunda lista, que es lo que la hizo
   * invisible durante meses.
   *
   * La ráfaga 2 la borra quitando este flag. Ningún otro uso previsto: si algún día
   * hace falta una segunda sección oculta, conviene preguntarse antes por qué.
   */
  hiddenFromNav?: boolean;
}

/**
 * EL ORDEN DE ESTA LISTA ES EL ORDEN DE LA BARRA LATERAL. Es el mismo que tenía
 * `NAV_ITEMS`, conservado literalmente para que el refactor no mueva ni un ítem de
 * sitio. Los agrupamientos que documentaban los comentarios de `NAV_ITEMS` se
 * conservan también, porque explican POR QUÉ el orden es éste.
 */
export const BACKOFFICE_SECTIONS: readonly BackofficeSection[] = [
  { id: 'dashboard', route: '/admin', label: 'Dashboard', minRole: 'ADMIN', exact: true },

  { id: 'anuncios', route: '/admin/anuncios', label: 'Anuncios', minRole: 'MODERATOR' },
  // MODERACIÓN M3 — la cola va junto a Anuncios: es trabajo PENDIENTE, no una
  // vista de consulta. Antes su sitio era filtrar «En revisión» en Anuncios, y de
  // ahí salía que el moderador despachara con el selector de estado genérico.
  { id: 'cola-revision', route: '/admin/moderacion', label: 'Cola de revisión', minRole: 'MODERATOR' },
  { id: 'usuarios', route: '/admin/usuarios', label: 'Usuarios', minRole: 'MODERATOR' },
  { id: 'reportes', route: '/admin/reportes', label: 'Reportes', minRole: 'MODERATOR' },
  { id: 'tickets', route: '/admin/tickets', label: 'Tickets', minRole: 'MODERATOR' },

  { id: 'facturacion', route: '/admin/facturacion', label: 'Facturación', minRole: 'ADMIN' },
  { id: 'facturas', route: '/admin/facturas', label: 'Facturas', minRole: 'ADMIN' },

  { id: 'categorias', route: '/admin/categorias', label: 'Categorías', minRole: 'ADMIN' },
  // B1 — el catálogo de tags es config del vocabulario, junto a Categorías.
  { id: 'tags', route: '/admin/tags', label: 'Tags', minRole: 'ADMIN' },

  { id: 'blog', route: '/admin/blog', label: 'Blog', minRole: 'EDITOR' },
  { id: 'paginas', route: '/admin/paginas', label: 'Páginas', minRole: 'EDITOR' },

  { id: 'footer', route: '/admin/footer', label: 'Footer', minRole: 'ADMIN' },
  // RN.4 — junto a Footer: son las dos navegaciones configurables del sitio.
  { id: 'nav', route: '/admin/nav', label: 'Navegación', minRole: 'ADMIN' },
  // RP.3 — junto a Footer y Navegación: las tres son CONFIGURACIÓN del sitio,
  // no contenido como Blog/Páginas (que sí abren a EDITOR).
  { id: 'portada', route: '/admin/portada', label: 'Portada', minRole: 'ADMIN' },

  { id: 'campanas', route: '/admin/campaigns', label: 'Campañas', minRole: 'ADMIN' },
  { id: 'cupones', route: '/admin/cupones', label: 'Cupones', minRole: 'ADMIN' },
  { id: 'banners', route: '/admin/banners', label: 'Banners', minRole: 'ADMIN' },
  { id: 'patrocinados', route: '/admin/sponsored-ads', label: 'Patrocinados', minRole: 'ADMIN' },

  { id: 'mensajes-contacto', route: '/admin/mensajes-contacto', label: 'Mensajes de contacto', minRole: 'ADMIN' },
  // Ver `hiddenFromNav`: sección real, sin ítem de nav, tal como estaba.
  { id: 'motivos-contacto', route: '/admin/motivos-contacto', label: 'Motivos de contacto', minRole: 'ADMIN', hiddenFromNav: true },

  { id: 'ajustes', route: '/admin/ajustes', label: 'Ajustes', minRole: 'ADMIN' },
] as const;

/**
 * `/admin/login` es la puerta de entrada al panel — NO puede caer bajo el guard de
 * `/admin/*` (exige sesión + rol), o nadie podría llegar a ella nunca (bucle: para
 * entrar necesitas estar ya dentro). Por eso NO es una sección: su propia página y
 * su endpoint controlan el acceso (ver `AuthService.adminLogin`, que rechaza tras
 * validar credenciales, nunca antes).
 */
export const ADMIN_LOGIN_PATH = '/admin/login';

/** La raíz del backoffice. Todo lo que cuelgue de aquí pasa por el gate de rol. */
export const ADMIN_ROOT = '/admin';

/**
 * La sección a la que pertenece una ruta, o `null` si no pertenece a ninguna.
 *
 * COINCIDENCIA POR SEGMENTO, NO POR PREFIJO — y esto es un arreglo, no un detalle
 * (hallazgo R4 de la auditoría). El middleware usaba `pathname.startsWith(p)`, así
 * que `/admin/anuncios-borrador` habría casado con la sección `/admin/anuncios` y
 * se habría abierto sola a MODERATOR. Hoy no hay colisión porque esa ruta no
 * existe; es una bomba de relojería que se desactiva aquí.
 *
 * SE ELIGE LA COINCIDENCIA MÁS LARGA. Con el inventario actual ninguna sección es
 * prefijo de otra, así que el desempate no se ejerce — pero en cuanto exista una
 * sección anidada (p. ej. `/admin/facturacion/emisor` como sección propia), lo
 * correcto es que gane la más específica y no el orden de declaración de la lista.
 */
export function sectionForPath(pathname: string): BackofficeSection | null {
  let mejor: BackofficeSection | null = null;
  for (const section of BACKOFFICE_SECTIONS) {
    if (!matchesSection(pathname, section)) continue;
    if (!mejor || section.route.length > mejor.route.length) mejor = section;
  }
  return mejor;
}

/**
 * ¿Pertenece esta ruta a esta sección? Es la regla ÚNICA de pertenencia, y la usan
 * tanto el gate (`sectionForPath`) como el resaltado del nav — antes eran dos
 * comparaciones escritas por separado que podían discrepar.
 */
export function matchesSection(pathname: string, section: BackofficeSection): boolean {
  if (section.exact) return pathname === section.route;
  return pathname === section.route || pathname.startsWith(`${section.route}/`);
}

/**
 * ¿Puede este rol entrar en esta ruta del backoffice?
 *
 * FAIL-CLOSED ANTE UNA RUTA SIN SECCIÓN. Una ruta bajo `/admin` que no casa con
 * ninguna fila del mapa se deniega **a todos, incluido ADMIN**. Es un cambio
 * deliberado respecto al comportamiento anterior (donde un ADMIN llegaba a la
 * página y recibía el 404 de Next), y es lo que hace que el mapa sea de verdad la
 * fuente única: una sección nueva sin fila aquí es inaccesible para todo el mundo
 * —una molestia inmediata y visible en desarrollo— en vez de accesible solo para
 * ADMIN y ausente del nav, que es exactamente cómo `/admin/motivos-contacto` pasó
 * meses sin que nadie lo notara. Ver docs/diseno-roles.md §2.6.
 */
export function canAccessAdminPath(role: string | null | undefined, pathname: string): boolean {
  const section = sectionForPath(pathname);
  if (!section) return false;
  return atLeast(role, section.minRole);
}

/** Las secciones que un rol ve en la barra lateral, en el orden del mapa. */
export function navSectionsFor(role: string | null | undefined): BackofficeSection[] {
  return BACKOFFICE_SECTIONS.filter(
    (section) => !section.hiddenFromNav && atLeast(role, section.minRole),
  );
}
