import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  ADMIN_LOGIN_PATH,
  ADMIN_ROOT,
  BACKOFFICE_SECTIONS,
  canAccessAdminPath,
  navSectionsFor,
  sectionForPath,
} from './backoffice-sections';
import { ROLE_ORDER } from './roles';

/**
 * ROLES RÁFAGA 1 — T1 del plan de verificación (docs/diseno-roles.md §6.1):
 * **la barrera de la fuente única**.
 *
 * Dos cosas distintas se afirman aquí, y conviene no confundirlas:
 *
 *  · **Que el refactor no cambió el acceso** (§«inventario congelado»). Se pinza
 *    reproduciendo LITERALMENTE las dos listas que se han borrado —el
 *    `ROLE_ALLOWED_PATHS` del middleware y los `roles[]` de `NAV_ITEMS`, tal como
 *    estaban antes de esta ráfaga— y comprobando que la derivación nueva decide
 *    exactamente lo mismo para las 4 × 22 combinaciones de rol y sección. Esto es
 *    la red de seguridad del refactor a nivel unitario; los 22 e2e de
 *    `admin-roles.spec.ts` son la misma red a nivel de navegador.
 *
 *  · **Que la fuente única se respeta** — que nav y middleware no pueden
 *    discrepar, que ninguna ruta real se queda fuera del mapa, y que la
 *    coincidencia es por segmento. Eso es lo que seguirá protegiendo cuando la
 *    ráfaga 2 cambie el inventario.
 */

// ─────────────────────────────────────────────────────────────────────────────
// EL INVENTARIO DE ANTES DEL REFACTOR, transcrito literalmente.
// NO se toca al cambiar el reparto: en la ráfaga 2, el bloque «inventario
// congelado» de abajo se retira entero y se sustituye por el reparto nuevo. Su
// trabajo es exclusivamente demostrar que ESTA ráfaga no movió nada.
// ─────────────────────────────────────────────────────────────────────────────

/** `ROLE_ALLOWED_PATHS` de `middleware.ts`, tal cual estaba. ADMIN tenía acceso total aparte. */
const ROLE_ALLOWED_PATHS_ANTES: Record<string, string[]> = {
  MODERATOR: [
    '/admin/reportes',
    '/admin/anuncios',
    '/admin/moderacion',
    '/admin/usuarios',
    '/admin/blog',
    '/admin/paginas',
    '/admin/tickets',
  ],
  EDITOR: ['/admin/blog', '/admin/paginas'],
};

/** La decisión de acceso del middleware ANTIGUO, reimplementada tal cual. */
function accesoAntiguo(role: string, pathname: string): boolean {
  if (role === 'ADMIN') return true;
  return ROLE_ALLOWED_PATHS_ANTES[role]?.some((p) => pathname.startsWith(p)) ?? false;
}

/** `NAV_ITEMS` de `AdminNav.tsx`, tal cual estaba: 21 ítems con sus roles enumerados. */
const NAV_ITEMS_ANTES: { href: string; label: string; roles: string[] }[] = [
  { href: '/admin', label: 'Dashboard', roles: ['ADMIN'] },
  { href: '/admin/anuncios', label: 'Anuncios', roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/moderacion', label: 'Cola de revisión', roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/usuarios', label: 'Usuarios', roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/reportes', label: 'Reportes', roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/tickets', label: 'Tickets', roles: ['ADMIN', 'MODERATOR'] },
  { href: '/admin/facturacion', label: 'Facturación', roles: ['ADMIN'] },
  { href: '/admin/facturas', label: 'Facturas', roles: ['ADMIN'] },
  { href: '/admin/categorias', label: 'Categorías', roles: ['ADMIN'] },
  { href: '/admin/tags', label: 'Tags', roles: ['ADMIN'] },
  { href: '/admin/blog', label: 'Blog', roles: ['ADMIN', 'MODERATOR', 'EDITOR'] },
  { href: '/admin/paginas', label: 'Páginas', roles: ['ADMIN', 'MODERATOR', 'EDITOR'] },
  { href: '/admin/footer', label: 'Footer', roles: ['ADMIN'] },
  { href: '/admin/nav', label: 'Navegación', roles: ['ADMIN'] },
  { href: '/admin/portada', label: 'Portada', roles: ['ADMIN'] },
  { href: '/admin/campaigns', label: 'Campañas', roles: ['ADMIN'] },
  { href: '/admin/cupones', label: 'Cupones', roles: ['ADMIN'] },
  { href: '/admin/banners', label: 'Banners', roles: ['ADMIN'] },
  { href: '/admin/sponsored-ads', label: 'Patrocinados', roles: ['ADMIN'] },
  { href: '/admin/mensajes-contacto', label: 'Mensajes de contacto', roles: ['ADMIN'] },
  { href: '/admin/ajustes', label: 'Ajustes', roles: ['ADMIN'] },
];

const ROLES_STAFF = ['EDITOR', 'MODERATOR', 'ADMIN'] as const;

describe('INVENTARIO CONGELADO — la derivación decide lo mismo que las listas borradas', () => {
  it.each(ROLE_ORDER.map((r) => [r]))(
    '%s: el acceso a las 22 secciones es idéntico al del middleware antiguo',
    (role) => {
      for (const section of BACKOFFICE_SECTIONS) {
        expect({ role, route: section.route, acceso: canAccessAdminPath(role, section.route) }).toEqual({
          role,
          route: section.route,
          acceso: accesoAntiguo(role, section.route),
        });
      }
    },
  );

  it.each(ROLE_ORDER.map((r) => [r]))(
    '%s: el acceso a las SUBRUTAS reales es idéntico al del middleware antiguo',
    (role) => {
      // Las subrutas son donde el cambio de `startsWith` a coincidencia por
      // segmento podría haber movido algo. Se comprueban las que existen de verdad.
      const subrutas = [
        '/admin/blog/nuevo',
        '/admin/blog/abc/editar',
        '/admin/paginas/nueva',
        '/admin/paginas/abc/editar',
        '/admin/tickets/nuevo',
        '/admin/tickets/abc',
        '/admin/facturacion/usuarios/abc',
        '/admin/facturas/emisor',
        '/admin/mensajes-contacto/abc',
      ];
      for (const ruta of subrutas) {
        expect({ role, ruta, acceso: canAccessAdminPath(role, ruta) }).toEqual({
          role,
          ruta,
          acceso: accesoAntiguo(role, ruta),
        });
      }
    },
  );

  it.each(ROLES_STAFF.map((r) => [r]))(
    '%s: el nav muestra exactamente los mismos ítems, en el mismo orden y con las mismas etiquetas',
    (role) => {
      const ahora = navSectionsFor(role).map((s) => ({ href: s.route, label: s.label }));
      const antes = NAV_ITEMS_ANTES.filter((i) => i.roles.includes(role)).map((i) => ({
        href: i.href,
        label: i.label,
      }));
      expect(ahora).toEqual(antes);
    },
  );

  it('las cuentas del nav son las que pinzan los tres e2e: ADMIN 21 / MODERATOR 7 / EDITOR 2', () => {
    // Si esta línea cambia en esta ráfaga, el refactor alteró el inventario y hay
    // un error. La ráfaga 2 la sustituirá por 22 / 19 / 7 a propósito.
    expect(navSectionsFor('ADMIN')).toHaveLength(21);
    expect(navSectionsFor('MODERATOR')).toHaveLength(7);
    expect(navSectionsFor('EDITOR')).toHaveLength(2);
    expect(navSectionsFor('USER')).toHaveLength(0);
    expect(navSectionsFor(null)).toHaveLength(0);
  });

  it('la anomalía R3 se conserva declarada: motivos-contacto es alcanzable por ADMIN y no sale en el nav', () => {
    // Inventario congelado incluye conservar los defectos. Lo que cambia es que
    // ahora está DECLARADO (`hiddenFromNav`) en vez de ser la ausencia de una fila.
    expect(canAccessAdminPath('ADMIN', '/admin/motivos-contacto')).toBe(true);
    expect(navSectionsFor('ADMIN').some((s) => s.id === 'motivos-contacto')).toBe(false);
    expect(accesoAntiguo('ADMIN', '/admin/motivos-contacto')).toBe(true);
    expect(NAV_ITEMS_ANTES.some((i) => i.href === '/admin/motivos-contacto')).toBe(false);
  });
});

describe('LA BARRERA — nav y middleware no pueden discrepar', () => {
  it.each(ROLE_ORDER.map((r) => [r]))(
    '%s: el nav nunca muestra un ítem que el middleware denegaría',
    (role) => {
      for (const section of navSectionsFor(role)) {
        expect(canAccessAdminPath(role, section.route)).toBe(true);
      }
    },
  );

  it.each(ROLE_ORDER.map((r) => [r]))(
    '%s: toda sección accesible sale en el nav, salvo las declaradas ocultas',
    (role) => {
      const enNav = new Set(navSectionsFor(role).map((s) => s.id));
      for (const section of BACKOFFICE_SECTIONS) {
        if (!canAccessAdminPath(role, section.route)) continue;
        expect(enNav.has(section.id) || section.hiddenFromNav === true).toBe(true);
      }
    },
  );
});

describe('el mapa cubre TODAS las rutas reales del backoffice', () => {
  // Este es el test que hace imposible repetir R3: una sección nueva en disco sin
  // fila en el mapa rompe CI. Se lee del sistema de ficheros a propósito — una
  // lista de rutas escrita a mano aquí sería otra lista que olvidar.
  const ADMIN_DIR = join(__dirname, '..', 'app', '(admin)', 'admin');

  const rutasEnDisco = existsSync(ADMIN_DIR)
    ? readdirSync(ADMIN_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('('))
        .map((e) => `/admin/${e.name}`)
    : [];

  it('encuentra las rutas en disco (red del propio test)', () => {
    expect(rutasEnDisco.length).toBeGreaterThan(15);
  });

  it.each(rutasEnDisco.map((r) => [r]))('%s tiene una sección declarada', (ruta) => {
    expect(sectionForPath(ruta)).not.toBeNull();
  });

  it('no hay secciones declaradas que no existan en disco', () => {
    const enDisco = new Set([...rutasEnDisco, ADMIN_ROOT]);
    for (const section of BACKOFFICE_SECTIONS) {
      expect(enDisco.has(section.route)).toBe(true);
    }
  });

  it('el dashboard (/admin) existe como página raíz', () => {
    expect(existsSync(join(ADMIN_DIR, 'page.tsx'))).toBe(true);
    expect(sectionForPath(ADMIN_ROOT)?.id).toBe('dashboard');
  });
});

describe('sectionForPath — coincidencia por SEGMENTO (arreglo de R4)', () => {
  it('casa la ruta exacta y sus subrutas', () => {
    expect(sectionForPath('/admin/anuncios')?.id).toBe('anuncios');
    expect(sectionForPath('/admin/anuncios/')?.id).toBe('anuncios');
    expect(sectionForPath('/admin/blog/nuevo')?.id).toBe('blog');
    expect(sectionForPath('/admin/facturacion/usuarios/abc')?.id).toBe('facturacion');
  });

  it('NO casa una ruta hermana que solo comparte prefijo de texto', () => {
    // Con el `startsWith` antiguo, esto habría sido la sección `anuncios` y se
    // habría abierto sola a MODERATOR. Es la bomba de relojería R4.
    expect(sectionForPath('/admin/anuncios-borrador')).toBeNull();
    expect(sectionForPath('/admin/blogs')).toBeNull();
    expect(sectionForPath('/admin/navegacion')).toBeNull();
  });

  it('/admin no se traga las demás secciones', () => {
    expect(sectionForPath('/admin')?.id).toBe('dashboard');
    expect(sectionForPath('/admin/ajustes')?.id).toBe('ajustes');
  });

  it('gana la coincidencia MÁS LARGA, no el orden de declaración', () => {
    // `exact` se excluye del cómputo: TODA sección cuelga de `/admin`, y es
    // precisamente `exact: true` lo que impide que el dashboard las capture (si
    // se le quitara, este cálculo devolvería las 21 y el test lo diría).
    const anidadas = BACKOFFICE_SECTIONS.filter((a) =>
      BACKOFFICE_SECTIONS.some((b) => b !== a && !b.exact && a.route.startsWith(`${b.route}/`)),
    ).map((s) => s.id);
    // Con el inventario actual no hay secciones anidadas, así que el desempate no
    // se ejerce; se afirma para que quede constancia de que el día que exista una
    // (p. ej. `/admin/facturas/emisor` como sección propia), `sectionForPath` ya
    // la resuelve por longitud y no por orden de declaración.
    expect(anidadas).toEqual([]);
    expect(sectionForPath('/admin/facturacion')?.id).toBe('facturacion');
  });

  it('la raíz `/admin` es `exact` — sin eso, capturaría TODAS las demás secciones', () => {
    const raiz = BACKOFFICE_SECTIONS.find((s) => s.route === ADMIN_ROOT);
    expect(raiz?.exact).toBe(true);
    // La consecuencia concreta, afirmada para que se vea el porqué del flag.
    expect(sectionForPath('/admin/ajustes')?.id).toBe('ajustes');
    expect(sectionForPath('/admin/ruta-que-no-existe')).toBeNull();
  });

  it('devuelve null fuera del backoffice', () => {
    expect(sectionForPath('/')).toBeNull();
    expect(sectionForPath('/mis-anuncios')).toBeNull();
    expect(sectionForPath('/administracion')).toBeNull();
  });
});

describe('canAccessAdminPath — fail-closed', () => {
  it('deniega a TODOS, incluido ADMIN, una ruta de /admin sin sección', () => {
    for (const role of ROLE_ORDER) {
      expect(canAccessAdminPath(role, '/admin/seccion-inexistente')).toBe(false);
    }
  });

  it('deniega sin rol y con un rol desconocido', () => {
    expect(canAccessAdminPath(null, '/admin/blog')).toBe(false);
    expect(canAccessAdminPath(undefined, '/admin/blog')).toBe(false);
    expect(canAccessAdminPath('SUPERUSER', '/admin/blog')).toBe(false);
    expect(canAccessAdminPath('', '/admin/blog')).toBe(false);
  });

  it('/admin/login NO es una sección — si lo fuera, el gate cerraría la puerta de entrada', () => {
    expect(sectionForPath(ADMIN_LOGIN_PATH)).toBeNull();
    expect(BACKOFFICE_SECTIONS.some((s) => s.route === ADMIN_LOGIN_PATH)).toBe(false);
  });
});

describe('integridad del mapa', () => {
  it('los ids son únicos', () => {
    const ids = BACKOFFICE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('las rutas son únicas y cuelgan de /admin', () => {
    const rutas = BACKOFFICE_SECTIONS.map((s) => s.route);
    expect(new Set(rutas).size).toBe(rutas.length);
    for (const ruta of rutas) {
      expect(ruta === ADMIN_ROOT || ruta.startsWith(`${ADMIN_ROOT}/`)).toBe(true);
      expect(ruta.endsWith('/')).toBe(false);
    }
  });

  it('las etiquetas son únicas (dos ítems con el mismo nombre son ambiguos para quien los lee)', () => {
    const labels = BACKOFFICE_SECTIONS.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('todo minRole está en la escalera y ninguna sección se abre a USER', () => {
    for (const section of BACKOFFICE_SECTIONS) {
      expect(ROLE_ORDER).toContain(section.minRole);
      expect(section.minRole).not.toBe('USER');
    }
  });
});
