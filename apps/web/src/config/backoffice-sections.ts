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
 *
 * ─── LOS GRUPOS (punto 3 del lote de retoques) ────────────────────────────────
 *
 * Veintidós entradas planas no son navegación. Se agrupan **por tarea**, con el molde
 * de `account-nav.ts` —el mismo que cita la cabecera— que ya lo hizo para trece con la
 * razón escrita: «agrupadas se leen de un vistazo».
 *
 * **AGRUPAR NO ES OCULTAR, y esto es lo que permite hacerlo sin tocar R2.** El flag
 * borrado arriba producía secciones ALCANZABLES QUE NO ESTABAN EN EL NAV; un grupo
 * produce secciones que están en el nav, en el segundo nivel. `/admin/motivos-contacto`
 * —el caso que motivó todo esto— deja de ocupar una fila de primer nivel y sigue,
 * literalmente, en `navSectionsFor` y en el DOM. Los invariantes de R2 se comprueban
 * sobre `navSectionsFor`, que esta ráfaga **no toca**: siguen verdes sin una sola
 * línea nueva. Ver `docs/diseno-nav-backoffice.md` §5.
 *
 * No hay, ni debe haber, ninguna forma de que una sección accesible se quede fuera del
 * nav: `group` es obligatorio y `navGroupsFor` deriva de `navSectionsFor` (ver los dos).
 */

/** Los seis grupos de la barra. Ver `BACKOFFICE_GROUPS` para el orden y los títulos. */
export type BackofficeGroupId =
  | 'moderacion'
  | 'atencion'
  | 'catalogo'
  | 'contenido'
  | 'promocion'
  | 'plataforma';

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
   * El grupo de la barra al que pertenece, o `null` para la RAÍZ (`/admin`), que va
   * suelta encima de todos porque es la raíz de las demás y no un hermano suyo.
   *
   * **EXPLÍCITO, no opcional (`group?:`), y no es una preferencia de estilo.** Con
   * opcional, olvidar el campo al añadir una sección la dejaría fuera de todos los
   * grupos, y una sección que no cae en ningún grupo es una sección que el nav no
   * pinta: **el defecto R3 otra vez**, por descuido en vez de por diseño. Con
   * `| null`, TypeScript obliga a escribir la decisión, y un test fija que sólo la
   * raíz la toma.
   *
   * **La pertenencia vive AQUÍ, en la fila, nunca en el grupo.** Un `BACKOFFICE_GROUPS`
   * que enumerase ids de sección sería una segunda lista de membresía capaz de
   * contradecir a ésta — que es exactamente la clase de defecto (dos listas a mano que
   * divergen) que R1 vino a cerrar.
   */
  group: BackofficeGroupId | null;
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
 * LOS GRUPOS DE LA BARRA — sólo su ORDEN y su TÍTULO.
 *
 * **Deliberadamente NO enumera secciones.** Quién pertenece a qué vive en el campo
 * `group` de cada fila, y por eso esta lista no puede contradecir al mapa: no sabe
 * nada de membresía. Ver el doc-comment de `BackofficeSection.group`.
 *
 * El criterio es la TAREA, no el rol ni la forma de la URL — molde de `ACCOUNT_NAV`
 * (SHELL-D4). Que «Plataforma» coincida con las tres secciones ADMIN es consecuencia,
 * no criterio: el propio reparto de R2 ya las piensa juntas («todo + el dinero y la
 * configuración»).
 */
export const BACKOFFICE_GROUPS: readonly { id: BackofficeGroupId; title: string }[] = [
  { id: 'moderacion', title: 'Moderación' },
  { id: 'atencion', title: 'Atención al usuario' },
  { id: 'catalogo', title: 'Catálogo' },
  { id: 'contenido', title: 'Contenido' },
  { id: 'promocion', title: 'Promoción' },
  { id: 'plataforma', title: 'Plataforma' },
] as const;

/**
 * EL ORDEN DE ESTA LISTA SIGUE SIENDO EL ORDEN DE LA BARRA LATERAL, y ahora está
 * AGRUPADO: la raíz primero y después los seis grupos, cada uno con sus secciones
 * seguidas y en el orden de `BACKOFFICE_GROUPS`.
 *
 * *(El comentario anterior decía que el orden se conservaba «literalmente para que el
 * refactor no mueva ni un ítem de sitio». Era una restricción de R1 —un refactor no
 * debe mover nada— y ésta es justamente la ráfaga que viene a reorganizar, así que
 * Facturación y Facturas bajan al final con Ajustes y Portada sube junto a Blog.)*
 *
 * **QUE ESTÉN SEGUIDAS ES UN INVARIANTE, no una casualidad estética.** `navGroupsFor`
 * recorre los grupos en su orden y toma de cada uno las secciones en el orden de este
 * mapa; si una fila se colara fuera de su bloque, el nav agrupado dejaría de leerse en
 * el mismo orden que `navSectionsFor`. No hace falta recordarlo: el test
 * «agrupar no pierde, no añade y no reordena» lo comprueba, y cae si se rompe.
 */
export const BACKOFFICE_SECTIONS: readonly BackofficeSection[] = [
  // ── La raíz, fuera de todo grupo ────────────────────────────────────────────
  // R2 — el dashboard baja a EDITOR. Son AGREGADOS (activos, en revisión, usuarios
  // totales, cola, estado del índice), no datos de nadie en concreto: recortarlo
  // por rol exigiría un `getStats` de forma variable para proteger cifras que no
  // son sensibles. Ver docs/diseno-roles.md §4.5 (D-2).
  //
  // Se llama «Resumen» y no «Dashboard» (3a): la pantalla son esos agregados, y así
  // lo dice. «Inicio» competía con la portada pública, que es EL inicio del producto,
  // y la cabecera del shell ya dice «Backoffice» — el primer ítem no repite dónde estás.
  { id: 'dashboard', route: '/admin', label: 'Resumen', minRole: 'EDITOR', exact: true, group: null },

  // ── Moderación ─────────────────────────────────────────────────────────────
  { id: 'anuncios', route: '/admin/anuncios', label: 'Anuncios', minRole: 'MODERATOR', group: 'moderacion' },
  // MODERACIÓN M3 — la cola va junto a Anuncios: es trabajo PENDIENTE, no una
  // vista de consulta. Antes su sitio era filtrar «En revisión» en Anuncios, y de
  // ahí salía que el moderador despachara con el selector de estado genérico.
  { id: 'cola-revision', route: '/admin/moderacion', label: 'Cola de revisión', minRole: 'MODERATOR', group: 'moderacion' },
  // Usuarios va aquí y NO en Atención: desde esta sección se suspende, se banea y se
  // marca para revisión previa. Es el trabajo de moderar, no el de atender.
  { id: 'usuarios', route: '/admin/usuarios', label: 'Usuarios', minRole: 'MODERATOR', group: 'moderacion' },
  { id: 'reportes', route: '/admin/reportes', label: 'Reportes', minRole: 'MODERATOR', group: 'moderacion' },

  // ── Atención al usuario ────────────────────────────────────────────────────
  { id: 'tickets', route: '/admin/tickets', label: 'Tickets', minRole: 'MODERATOR', group: 'atencion' },
  // R2 — las DOS de contacto bajan JUNTAS, y no por simetría: la pantalla de
  // mensajes importa el cliente de motivos (`admin-contact-reasons`), así que
  // bajar una sola dejaría la otra cargando rota. Es INV-1, verificado en los
  // imports (docs/diseno-roles.md §4.3).
  { id: 'mensajes-contacto', route: '/admin/mensajes-contacto', label: 'Mensajes de contacto', minRole: 'MODERATOR', group: 'atencion' },
  // 3c — AQUÍ, y no en el primer nivel. Es la sección del hallazgo R3: existía, era
  // alcanzable y no tenía ítem de nav; R2 se lo dio. Este grupo la baja de nivel SIN
  // quitárselo — sigue en `navSectionsFor` y en el DOM, junto a la hermana con la que
  // comparte piso y desde cuya pantalla ya se llega. Bajar de nivel no es desaparecer.
  { id: 'motivos-contacto', route: '/admin/motivos-contacto', label: 'Motivos de contacto', minRole: 'MODERATOR', group: 'atencion' },

  // ── Catálogo ───────────────────────────────────────────────────────────────
  // R2 — el catálogo (categorías y tags) baja a MODERATOR: es la materia prima del
  // trabajo de moderar, no configuración de plataforma. Con `categorias` viaja la
  // casilla `requiresReview` de la categoría — ver la enmienda a M4 en
  // docs/diseno-roles.md §5 y el comentario de `updateCategory`.
  { id: 'categorias', route: '/admin/categorias', label: 'Categorías', minRole: 'MODERATOR', group: 'catalogo' },
  // B1 — el catálogo de tags es config del vocabulario, junto a Categorías.
  { id: 'tags', route: '/admin/tags', label: 'Tags', minRole: 'MODERATOR', group: 'catalogo' },

  // ── Contenido ──────────────────────────────────────────────────────────────
  // R2 — Footer, Navegación y Portada bajan a EDITOR. El comentario de RP.3 decía
  // que las tres son «CONFIGURACIÓN del sitio, no contenido como Blog/Páginas (que
  // sí abren a EDITOR)», y ese criterio queda REVISADO: las tres son la superficie
  // editorial del sitio público —qué se enseña y cómo se navega—, que es el mismo
  // oficio que el blog. Configuración de plataforma es lo que sigue en ADMIN:
  // facturación, facturas y ajustes.
  { id: 'blog', route: '/admin/blog', label: 'Blog', minRole: 'EDITOR', group: 'contenido' },
  { id: 'paginas', route: '/admin/paginas', label: 'Páginas', minRole: 'EDITOR', group: 'contenido' },
  { id: 'portada', route: '/admin/portada', label: 'Portada', minRole: 'EDITOR', group: 'contenido' },
  { id: 'footer', route: '/admin/footer', label: 'Footer', minRole: 'EDITOR', group: 'contenido' },
  // RN.4 — junto a Footer: son las dos navegaciones configurables del sitio.
  { id: 'nav', route: '/admin/nav', label: 'Navegación', minRole: 'EDITOR', group: 'contenido' },

  // ── Promoción ──────────────────────────────────────────────────────────────
  { id: 'campanas', route: '/admin/campaigns', label: 'Campañas', minRole: 'MODERATOR', group: 'promocion' },
  { id: 'cupones', route: '/admin/cupones', label: 'Cupones', minRole: 'MODERATOR', group: 'promocion' },
  // R2 — las dos bajan, pero NO al mismo piso, y la distinción es deliberada:
  // un banner es pieza de la portada (mismo oficio que el resto de EDITOR),
  // mientras que un patrocinado es inventario VENDIDO a un anunciante — tocarlo
  // es tocar lo que alguien ha pagado, así que baja sólo hasta MODERATOR.
  { id: 'banners', route: '/admin/banners', label: 'Banners', minRole: 'EDITOR', group: 'promocion' },
  { id: 'patrocinados', route: '/admin/sponsored-ads', label: 'Patrocinados', minRole: 'MODERATOR', group: 'promocion' },

  // ── Plataforma ─────────────────────────────────────────────────────────────
  // Las tres que R2 dejó en ADMIN, y el propio reparto ya las nombra juntas: «todo
  // + el dinero y la configuración». Agrupar por tarea las junta igual.
  //
  // ESTADÍSTICAS B1 — LA PRIMERA FILA `MODERATOR` DE ESTE GRUPO, y no es una anomalía:
  // el criterio de los grupos es LA TAREA, no el rol. Está escrito arriba con todas las
  // letras — «Que "Plataforma" coincida con las tres secciones ADMIN es CONSECUENCIA, no
  // criterio»— y el encargo llama a esto, literalmente, «monitoreo de PLATAFORMA».
  //
  // Un MODERATOR verá el grupo con un solo ítem dentro y un ADMIN con cuatro, que es
  // exactamente lo que `navGroupsFor` hace sin ninguna regla nueva: filtra por rol
  // apoyándose en `navSectionsFor` y reparte lo que queda.
  //
  // VA LA PRIMERA DEL BLOQUE porque es la de piso más bajo. Y va SEGUIDA de las otras
  // tres, que es un invariante con test («agrupar no pierde, no añade y no reordena»),
  // no una preferencia estética.
  //
  // SIN ESTA FILA LA RUTA NO EXISTE PARA NADIE, ni siquiera para ADMIN:
  // `canAccessAdminPath` es fail-closed ante una ruta sin sección. Es deliberado (ver su
  // doc-comment) y es la razón de que esta línea sea el paso 1 de la ráfaga y no el
  // último.
  { id: 'estadisticas', route: '/admin/estadisticas', label: 'Estadísticas', minRole: 'MODERATOR', group: 'plataforma' },
  { id: 'facturacion', route: '/admin/facturacion', label: 'Facturación', minRole: 'ADMIN', group: 'plataforma' },
  { id: 'facturas', route: '/admin/facturas', label: 'Facturas', minRole: 'ADMIN', group: 'plataforma' },
  { id: 'ajustes', route: '/admin/ajustes', label: 'Ajustes', minRole: 'ADMIN', group: 'plataforma' },
  // LOGOS L2 — los tres logos de la instancia. ADMIN y en «Plataforma», junto a Ajustes
  // e Instancia y no en «Contenido» con Portada/Footer/Nav: aquéllas son la superficie
  // EDITORIAL del sitio público —qué se enseña y cómo se navega—, y ésta es la
  // identidad de la instalación. El logo del backoffice, además, es lo que distingue un
  // despliegue de otro (docs/diseno-logos.md §8), que es literalmente la pregunta que
  // contesta su vecina «Instancia».
  { id: 'marca', route: '/admin/marca', label: 'Marca', minRole: 'ADMIN', group: 'plataforma' },
  // E7 — al lado de Marca y por lo mismo: las dos son «el aspecto de ESTA instancia», y
  // las dos funcionan igual (el código trae un valor por defecto, el admin lo sustituye).
  // Pantalla propia y no una pestaña de Marca: aquélla son tres logos y ésta diez slots
  // con previsualización doble; juntas no se recorren.
  {
    id: 'ilustraciones',
    route: '/admin/ilustraciones',
    label: 'Ilustraciones',
    minRole: 'ADMIN',
    group: 'plataforma',
  },
  // AJUSTES RÁFAGA B — «cómo está montada esta instancia», de solo lectura. Va DESPUÉS de
  // Ajustes y no antes: aquélla es donde se cambia y ésta donde se confirma, y en ese orden
  // se leen. ADMIN porque publica de golpe la configuración de la máquina.
  { id: 'instancia', route: '/admin/instancia', label: 'Instancia', minRole: 'ADMIN', group: 'plataforma' },
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
 * ROLES R3 — LA PUERTA QUE LE TOCA A CADA ROL para volver a entrar.
 *
 * VIVE AQUÍ porque hasta R3 la regla estaba escrita a mano en `AdminUserBar`, y
 * R3 necesitaba la misma decisión en un segundo sitio (`AdminSessionGuard`). Dos
 * copias de una regla de acceso es exactamente el defecto que este cuerpo vino a
 * cerrar, así que se extrae a la primera ocasión en vez de a la tercera.
 *
 * ─── R4: LA PUERTA SE ABRIÓ A EDITOR+, Y ESTA FUNCIÓN NO CAMBIA ───────────────
 *
 * Parece que debería: si ahora un MODERATOR puede entrar por `/admin/login`, lo
 * natural sería devolvérselo. **Sería un error, y crearía un callejón sin salida
 * justo en el flujo que R3 construyó.**
 *
 * El motivo es que esta función se llama con el rol de la sesión que MUERE, que
 * puede estar caducado — de hecho el caso principal es exactamente ése: a alguien
 * le quitan el rol, `AdminSessionGuard` lo expulsa, y su cookie todavía dice
 * MODERATOR. Si le devolviéramos `/admin/login`, aterrizaría en una puerta que su
 * cuenta —ya degradada a USER— rechaza, sin nada que hacer allí.
 *
 * Así que la pregunta que responde NO es «¿qué puerta prefiere este rol?» sino
 * **«¿qué puerta lo va a admitir seguro?»**, y con las reglas del backend la
 * respuesta es estable:
 *
 *   · ADMIN → `/admin/login` OBLIGATORIO: `AuthService.login` lo rechaza con
 *     `ADMIN_MUST_USE_ADMIN_LOGIN`, y un ADMIN no puede ser degradado
 *     (`changeUserRole` se niega a tocarlo), así que su rol nunca queda caducado
 *     hacia abajo. Es el único caso en el que la puerta del panel es la segura.
 *   · Cualquier otro → `/login`, que admite a EDITOR, MODERATOR **y** USER. Es la
 *     única que sigue valiendo si el rol de la cookie ya no es cierto.
 *
 * Que EDITOR y MODERATOR puedan usar las DOS puertas es justo lo que hace segura
 * esta elección: mandarles a la pública nunca falla.
 */
export function backofficeLoginPathFor(role: string | null | undefined): string {
  return role === 'ADMIN' ? ADMIN_LOGIN_PATH : '/login';
}

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

/** Un grupo de la barra, ya resuelto para un rol: su título y las secciones que ve. */
export interface BackofficeNavGroup {
  id: BackofficeGroupId;
  title: string;
  items: BackofficeSection[];
}

/** Lo que la barra pinta: la raíz suelta arriba, y debajo los grupos con contenido. */
export interface BackofficeNav {
  /** Las secciones sin grupo (hoy sólo `/admin`), encima de todos los grupos. */
  root: BackofficeSection[];
  groups: BackofficeNavGroup[];
}

/**
 * LA BARRA AGRUPADA — y **se implementa SOBRE `navSectionsFor`, nunca en paralelo**.
 *
 * Ésa es la línea que sostiene todo el cambio, y no es estilo. Si esta función volviera
 * a filtrar por rol por su cuenta —un `atLeast` más, aquí— habría **dos reglas de
 * visibilidad**: los invariantes de R1/R2 seguirían midiendo `navSectionsFor` mientras
 * el nav se pintaría desde otra, y bastaría que discreparan para que una sección
 * accesible desapareciera del menú con todos los tests en verde. Es el defecto de R1
 * reencarnado un piso más arriba.
 *
 * Aquí no se decide NADA sobre quién ve qué: se recibe la lista ya filtrada y sólo se
 * reparte. Hay un test que lo fija por comportamiento —aplanar esto devuelve
 * exactamente `navSectionsFor`, en ids y en orden, para los cuatro roles—, así que
 * agrupar es demostrablemente no destructivo: no pierde, no añade y no reordena.
 *
 * **Los grupos vacíos NO se devuelven.** Un EDITOR ve siete secciones y ninguna de
 * moderación; un título «Moderación» sin nada debajo sería ruido que además sugiere
 * que hay algo ahí que no puede abrir.
 */
export function navGroupsFor(role: string | null | undefined): BackofficeNav {
  const visibles = navSectionsFor(role);
  return {
    root: visibles.filter((section) => section.group === null),
    groups: BACKOFFICE_GROUPS.map((grupo) => ({
      id: grupo.id,
      title: grupo.title,
      items: visibles.filter((section) => section.group === grupo.id),
    })).filter((grupo) => grupo.items.length > 0),
  };
}
