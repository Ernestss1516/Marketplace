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
 * ─── EL REPARTO (ráfaga 2 de 3) ────────────────────────────────────────────────
 *
 * La ráfaga 1 dejó este mapa poblado con el inventario ANTIGUO a propósito, para
 * poder cambiar el mecanismo sin mover el acceso. Ésta cambia el contenido:
 *
 *   · EDITOR (7)      contenido y presentación del sitio — dashboard, blog,
 *                     páginas, portada, footer, navegación, banners.
 *   · MODERATOR (19)  lo de EDITOR + el trabajo de moderar y el catálogo —
 *                     anuncios, cola, usuarios, reportes, tickets, categorías,
 *                     tags, campañas, cupones, patrocinados y los dos de contacto.
 *   · ADMIN (22)      todo + el dinero y la configuración — facturación,
 *                     facturas, ajustes.
 *
 * **Es UN cambio en TRES capas.** Middleware y nav derivan de este fichero desde la
 * ráfaga 1, así que cambiar doce `minRole` aquí reparte doce secciones en las dos.
 * Lo único que hubo que tocar aparte son los `@MinRole` del backend, y no por
 * descuido del mecanismo sino porque sección y endpoint no son 1:1 (ver arriba):
 * son el invariante INV-1 —«los endpoints que una sección necesita para cargar
 * tienen piso ≤ el de la sección»— y se verifica por comportamiento, cargando cada
 * sección con su rol nuevo (`admin-roles.spec.ts`).
 *
 * `hiddenFromNav` ha desaparecido con esta ráfaga: existía sólo para declarar la
 * anomalía R3 mientras el inventario estaba congelado. `/admin/motivos-contacto`
 * baja a MODERATOR y **gana por fin su ítem de nav**, así que ya no hay ninguna
 * sección oculta y el concepto sobra.
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
}

/**
 * EL ORDEN DE ESTA LISTA ES EL ORDEN DE LA BARRA LATERAL. Es el mismo que tenía
 * `NAV_ITEMS`, conservado literalmente para que el refactor no mueva ni un ítem de
 * sitio. Los agrupamientos que documentaban los comentarios de `NAV_ITEMS` se
 * conservan también, porque explican POR QUÉ el orden es éste.
 */
export const BACKOFFICE_SECTIONS: readonly BackofficeSection[] = [
  // R2 — el dashboard baja a EDITOR. Son AGREGADOS (activos, en revisión, usuarios
  // totales, cola, estado del índice), no datos de nadie en concreto: recortarlo
  // por rol exigiría un `getStats` de forma variable para proteger cifras que no
  // son sensibles. Ver docs/diseno-roles.md §4.5 (D-2).
  { id: 'dashboard', route: '/admin', label: 'Dashboard', minRole: 'EDITOR', exact: true },

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

  // R2 — el catálogo (categorías y tags) baja a MODERATOR: es la materia prima del
  // trabajo de moderar, no configuración de plataforma. Con `categorias` viaja la
  // casilla `requiresReview` de la categoría — ver la enmienda a M4 en
  // docs/diseno-roles.md §5 y el comentario de `updateCategory`.
  { id: 'categorias', route: '/admin/categorias', label: 'Categorías', minRole: 'MODERATOR' },
  // B1 — el catálogo de tags es config del vocabulario, junto a Categorías.
  { id: 'tags', route: '/admin/tags', label: 'Tags', minRole: 'MODERATOR' },

  { id: 'blog', route: '/admin/blog', label: 'Blog', minRole: 'EDITOR' },
  { id: 'paginas', route: '/admin/paginas', label: 'Páginas', minRole: 'EDITOR' },

  // R2 — Footer, Navegación y Portada bajan a EDITOR. El comentario de RP.3 decía
  // que las tres son «CONFIGURACIÓN del sitio, no contenido como Blog/Páginas (que
  // sí abren a EDITOR)», y ese criterio queda REVISADO: las tres son la superficie
  // editorial del sitio público —qué se enseña y cómo se navega—, que es el mismo
  // oficio que el blog. Configuración de plataforma es lo que sigue en ADMIN:
  // facturación, facturas y ajustes.
  { id: 'footer', route: '/admin/footer', label: 'Footer', minRole: 'EDITOR' },
  // RN.4 — junto a Footer: son las dos navegaciones configurables del sitio.
  { id: 'nav', route: '/admin/nav', label: 'Navegación', minRole: 'EDITOR' },
  { id: 'portada', route: '/admin/portada', label: 'Portada', minRole: 'EDITOR' },

  { id: 'campanas', route: '/admin/campaigns', label: 'Campañas', minRole: 'MODERATOR' },
  { id: 'cupones', route: '/admin/cupones', label: 'Cupones', minRole: 'MODERATOR' },
  // R2 — las dos bajan, pero NO al mismo piso, y la distinción es deliberada:
  // un banner es pieza de la portada (mismo oficio que el resto de EDITOR),
  // mientras que un patrocinado es inventario VENDIDO a un anunciante — tocarlo
  // es tocar lo que alguien ha pagado, así que baja sólo hasta MODERATOR.
  { id: 'banners', route: '/admin/banners', label: 'Banners', minRole: 'EDITOR' },
  { id: 'patrocinados', route: '/admin/sponsored-ads', label: 'Patrocinados', minRole: 'MODERATOR' },

  // R2 — las DOS de contacto bajan JUNTAS, y no por simetría: la pantalla de
  // mensajes importa el cliente de motivos (`admin-contact-reasons`), así que
  // bajar una sola dejaría la otra cargando rota. Es INV-1, verificado en los
  // imports (docs/diseno-roles.md §4.3).
  { id: 'mensajes-contacto', route: '/admin/mensajes-contacto', label: 'Mensajes de contacto', minRole: 'MODERATOR' },
  // Y aquí muere el hallazgo R3: esta sección existía, era alcanzable y NO tenía
  // ítem de nav. Con el nav derivado del mapa, darle una fila se lo da.
  { id: 'motivos-contacto', route: '/admin/motivos-contacto', label: 'Motivos de contacto', minRole: 'MODERATOR' },

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

/**
 * Las secciones que un rol ve en la barra lateral, en el orden del mapa.
 *
 * Desde la ráfaga 2 el nav es EXACTAMENTE «lo que puedes abrir»: no hay filtro de
 * visibilidad aparte del piso de rol, porque ya no queda ninguna sección oculta
 * (ver la cabecera). Que `navSectionsFor` y `canAccessAdminPath` se reduzcan a la
 * misma condición es lo que hace imposible, por construcción, el defecto R3.
 */
export function navSectionsFor(role: string | null | undefined): BackofficeSection[] {
  return BACKOFFICE_SECTIONS.filter((section) => atLeast(role, section.minRole));
}
