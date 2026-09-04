import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  ADMIN_LOGIN_PATH,
  ADMIN_ROOT,
  BACKOFFICE_GROUPS,
  BACKOFFICE_SECTIONS,
  canAccessAdminPath,
  navGroupsFor,
  navSectionsFor,
  sectionForPath,
} from './backoffice-sections';
import { ROLE_ORDER } from './roles';

/**
 * ROLES — T1 del plan de verificación (docs/diseno-roles.md §6.1): **la barrera de
 * la fuente única**.
 *
 * Dos cosas distintas se afirman aquí, y conviene no confundirlas:
 *
 *  · **EL REPARTO** (ráfaga 2): que cada rol ve EXACTAMENTE las secciones de la
 *    tabla, ni una más ni una menos. Se pinza con la lista literal por rol, no con
 *    el número: un test que solo cuente 19 pasaría igual con la sección
 *    equivocada dentro.
 *
 *  · **EL MECANISMO** (ráfaga 1, ya probado): que nav y middleware no pueden
 *    discrepar, que ninguna ruta real se queda fuera del mapa, y que la
 *    coincidencia es por segmento. Ese bloque NO cambia al cambiar el reparto —
 *    que siguiera verde mientras esta cabecera se reescribía entera es la prueba
 *    de que el mecanismo y el contenido están de verdad separados.
 *
 * El bloque de «inventario congelado» de la ráfaga 1 —que transcribía el
 * `ROLE_ALLOWED_PATHS` y los `NAV_ITEMS` borrados para demostrar que el refactor
 * no movía nada— ha cumplido su función y se retira: su punto de comparación era
 * el reparto viejo, que es justo lo que esta ráfaga cambia a propósito.
 */

// ─────────────────────────────────────────────────────────────────────────────
// EL REPARTO ESPERADO — la tabla de docs/diseno-roles.md §4.2, transcrita.
//
// Se escribe aquí ENTERA y a mano, en vez de derivarla de BACKOFFICE_SECTIONS,
// porque un test que lea el mismo dato que comprueba no comprueba nada: sería
// `mapa === mapa`. Esta lista es la INTENCIÓN (lo que se acordó); el mapa es la
// implementación. Cuando el reparto cambie de verdad habrá que tocar las dos, y
// eso es exactamente lo que se quiere de un cambio de política de acceso.
// ─────────────────────────────────────────────────────────────────────────────

/** id → piso mínimo acordado. 26 secciones: 7 EDITOR, 13 MODERATOR, 6 ADMIN. */
const REPARTO_ESPERADO: Record<string, 'EDITOR' | 'MODERATOR' | 'ADMIN'> = {
  // EDITOR — contenido y presentación del sitio público (7 en total)
  dashboard: 'EDITOR',
  blog: 'EDITOR',
  paginas: 'EDITOR',
  portada: 'EDITOR',
  footer: 'EDITOR',
  nav: 'EDITOR',
  banners: 'EDITOR',
  // MODERATOR — el trabajo de moderar y el catálogo (13 propias, 20 acumuladas)
  // ESTADÍSTICAS B1 — vive en el grupo «Plataforma» (donde están las tres ADMIN) pero su
  // PISO es MODERATOR: el grupo se decide por tarea y el piso por quién debe entrar. El
  // encargo pedía «moderadores y administradores», y encaja con que `/admin/anuncios` y
  // `/admin/usuarios` —las dos pantallas donde aterrizan estos datos— ya sean MODERATOR.
  estadisticas: 'MODERATOR',
  anuncios: 'MODERATOR',
  'cola-revision': 'MODERATOR',
  usuarios: 'MODERATOR',
  reportes: 'MODERATOR',
  tickets: 'MODERATOR',
  categorias: 'MODERATOR',
  tags: 'MODERATOR',
  campanas: 'MODERATOR',
  cupones: 'MODERATOR',
  patrocinados: 'MODERATOR',
  'mensajes-contacto': 'MODERATOR',
  'motivos-contacto': 'MODERATOR',
  // ADMIN — el dinero y la configuración de plataforma (6 propias, 26 acumuladas)
  facturacion: 'ADMIN',
  facturas: 'ADMIN',
  ajustes: 'ADMIN',
  instancia: 'ADMIN',
  // LOGOS L2 — la identidad de la instancia (los tres logos). ADMIN, como sus vecinas.
  marca: 'ADMIN',
  // E7 — las ilustraciones de la instancia. ADMIN por lo mismo que Marca: es el aspecto
  // de la plataforma entera, no contenido.
  ilustraciones: 'ADMIN',
};

const ROLES_STAFF = ['EDITOR', 'MODERATOR', 'ADMIN'] as const;

/** Las secciones que un rol debe ver, según el reparto acordado y la escalera. */
function seccionesEsperadas(role: 'EDITOR' | 'MODERATOR' | 'ADMIN'): string[] {
  const nivel = { EDITOR: 0, MODERATOR: 1, ADMIN: 2 };
  return Object.entries(REPARTO_ESPERADO)
    .filter(([, min]) => nivel[role] >= nivel[min])
    .map(([id]) => id);
}

describe('EL REPARTO — cada rol ve exactamente lo suyo', () => {
  it('el mapa declara el piso acordado para las 26 secciones, una por una', () => {
    const real = Object.fromEntries(BACKOFFICE_SECTIONS.map((s) => [s.id, s.minRole]));
    expect(real).toEqual(REPARTO_ESPERADO);
    expect(BACKOFFICE_SECTIONS).toHaveLength(26);
  });

  it.each(ROLES_STAFF.map((r) => [r]))(
    '%s ve EXACTAMENTE su lista de secciones (no solo el número)',
    (role) => {
      expect(navSectionsFor(role).map((s) => s.id).sort()).toEqual(seccionesEsperadas(role).sort());
    },
  );

  it('las cuentas resultantes son EDITOR 7 / MODERATOR 20 / ADMIN 26', () => {
    // Son las que pinzan los tres e2e de admin-roles.spec.ts. Antes de la ráfaga de
    // roles eran 2 / 7 / 21; el cambio es el objeto de aquella ráfaga, no un efecto
    // lateral. ESTADÍSTICAS B1 sumó UNA a MODERATOR y ADMIN (19→20, 22→23) y ninguna a
    // EDITOR: la telemetría no baja al piso del dashboard (ver `AdminStatsController`).
    // LOGOS L2 suma «Marca» SÓLO a ADMIN (24→25): la identidad de la instancia no baja.
    // E7 suma «Ilustraciones», también sólo a ADMIN (25→26), y por el mismo motivo.
    expect(navSectionsFor('EDITOR')).toHaveLength(7);
    expect(navSectionsFor('MODERATOR')).toHaveLength(20);
    expect(navSectionsFor('ADMIN')).toHaveLength(26);
  });

  it('USER sigue sin acceso a NADA del backoffice', () => {
    // No cambia en esta ráfaga y por eso mismo se afirma: repartir hacia abajo es
    // justo el movimiento que podría llevarse por delante el suelo.
    expect(navSectionsFor('USER')).toHaveLength(0);
    expect(navSectionsFor(null)).toHaveLength(0);
    for (const section of BACKOFFICE_SECTIONS) {
      expect(canAccessAdminPath('USER', section.route)).toBe(false);
    }
  });

  it('EDITOR no llega a lo de MODERATOR ni a lo de ADMIN', () => {
    for (const id of ['anuncios', 'usuarios', 'categorias', 'cupones', 'patrocinados']) {
      const s = BACKOFFICE_SECTIONS.find((x) => x.id === id)!;
      expect(canAccessAdminPath('EDITOR', s.route)).toBe(false);
    }
    for (const id of ['facturacion', 'facturas', 'ajustes']) {
      const s = BACKOFFICE_SECTIONS.find((x) => x.id === id)!;
      expect(canAccessAdminPath('EDITOR', s.route)).toBe(false);
    }
  });

  it('MODERATOR llega a lo de EDITOR y a lo suyo, pero NO al dinero ni a los ajustes', () => {
    for (const id of ['dashboard', 'portada', 'footer', 'nav', 'banners', 'categorias', 'tags']) {
      const s = BACKOFFICE_SECTIONS.find((x) => x.id === id)!;
      expect(canAccessAdminPath('MODERATOR', s.route)).toBe(true);
    }
    for (const id of ['facturacion', 'facturas', 'ajustes']) {
      const s = BACKOFFICE_SECTIONS.find((x) => x.id === id)!;
      expect(canAccessAdminPath('MODERATOR', s.route)).toBe(false);
    }
  });

  it.each(ROLE_ORDER.map((r) => [r]))(
    '%s: las subrutas reales heredan el piso de su sección',
    (role) => {
      const subrutas: [string, string][] = [
        ['/admin/blog/nuevo', 'blog'],
        ['/admin/blog/abc/editar', 'blog'],
        ['/admin/paginas/nueva', 'paginas'],
        ['/admin/paginas/abc/editar', 'paginas'],
        ['/admin/tickets/nuevo', 'tickets'],
        ['/admin/tickets/abc', 'tickets'],
        ['/admin/facturacion/usuarios/abc', 'facturacion'],
        ['/admin/facturas/emisor', 'facturas'],
        ['/admin/mensajes-contacto/abc', 'mensajes-contacto'],
      ];
      for (const [ruta, seccionId] of subrutas) {
        const seccion = BACKOFFICE_SECTIONS.find((s) => s.id === seccionId)!;
        expect({ ruta, acceso: canAccessAdminPath(role, ruta) }).toEqual({
          ruta,
          acceso: canAccessAdminPath(role, seccion.route),
        });
      }
    },
  );

  it('R3 CERRADO: motivos-contacto ya tiene ítem de nav, y no queda ninguna sección oculta', () => {
    // La ráfaga 1 conservó la anomalía declarándola (`hiddenFromNav`); ésta la
    // borra. Que el nav de un rol sea EXACTAMENTE lo que puede abrir es ahora una
    // propiedad, no una coincidencia — ver el test de la barrera más abajo.
    expect(navSectionsFor('MODERATOR').some((s) => s.id === 'motivos-contacto')).toBe(true);
    expect(canAccessAdminPath('MODERATOR', '/admin/motivos-contacto')).toBe(true);
    expect(navSectionsFor('ADMIN')).toHaveLength(BACKOFFICE_SECTIONS.length);
  });

  it('las dos secciones de contacto comparten piso (la de mensajes usa los endpoints de motivos)', () => {
    // INV-1 declarado como test: bajarlas por separado dejaría /admin/mensajes-
    // contacto cargando rota. Ver docs/diseno-roles.md §4.3.
    const mensajes = BACKOFFICE_SECTIONS.find((s) => s.id === 'mensajes-contacto')!;
    const motivos = BACKOFFICE_SECTIONS.find((s) => s.id === 'motivos-contacto')!;
    expect(motivos.minRole).toBe(mensajes.minRole);
  });

  it('footer y nav no pueden exigir menos que blog (dependen de sus endpoints)', () => {
    // La otra dependencia cruzada verificada: las dos pantallas usan
    // `/admin/blog*` para elegir la página de destino de un enlace.
    const nivel = { USER: 0, EDITOR: 1, MODERATOR: 2, ADMIN: 3 } as const;
    const blog = BACKOFFICE_SECTIONS.find((s) => s.id === 'blog')!;
    for (const id of ['footer', 'nav']) {
      const s = BACKOFFICE_SECTIONS.find((x) => x.id === id)!;
      expect(nivel[s.minRole]).toBeGreaterThanOrEqual(nivel[blog.minRole]);
    }
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
    '%s: toda sección accesible sale en el nav — ya no hay excepciones',
    (role) => {
      // En la ráfaga 1 esta aserción llevaba un «salvo las declaradas ocultas»
      // por `hiddenFromNav`. Con R3 cerrado, el nav y el acceso son la MISMA
      // condición y la excepción desaparece: es la forma más fuerte del test.
      const enNav = new Set(navSectionsFor(role).map((s) => s.id));
      for (const section of BACKOFFICE_SECTIONS) {
        if (!canAccessAdminPath(role, section.route)) continue;
        expect(enNav.has(section.id)).toBe(true);
      }
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// LOS GRUPOS (punto 3) — agrupar es ADITIVO, y esto es lo que lo demuestra
// ─────────────────────────────────────────────────────────────────────────────
//
// Los dos bloques de arriba miden `navSectionsFor`, que esta ráfaga NO toca. Siguen
// siendo el invariante de R1/R2 y siguen verdes sin una línea nueva. Lo que hace falta
// probar es lo único que cambia: que la vista agrupada dice EXACTAMENTE lo mismo.
describe('LA BARRERA DE LOS GRUPOS — agrupar no pierde, no añade y no reordena', () => {
  const aplanar = (role: string | null) => [
    ...navGroupsFor(role).root,
    ...navGroupsFor(role).groups.flatMap((g) => g.items),
  ];

  it.each(ROLE_ORDER.map((r) => [r]))(
    '%s: aplanar la barra agrupada devuelve `navSectionsFor`, en ids Y en orden',
    (role) => {
      // ÉSTE ES EL TEST DEL CUERPO. Mata las tres formas de romperlo a la vez:
      //
      //  · que `navGroupsFor` vuelva a filtrar por rol por su cuenta (habría DOS
      //    reglas de visibilidad, y los invariantes de arriba pasarían a vigilar una
      //    función que ya no alimenta al nav — R1 reencarnado);
      //  · que una sección se quede sin grupo o con un grupo que no existe (se caería
      //    del nav en silencio — R3 en versión suave);
      //  · que una fila se cuele fuera del bloque de su grupo en el mapa (el nav se
      //    leería en un orden distinto del declarado).
      expect(aplanar(role).map((s) => s.id)).toEqual(navSectionsFor(role).map((s) => s.id));
    },
  );

  it('cada sección declara su grupo, y sólo la RAÍZ va suelta', () => {
    // `group` es `| null` explícito y no `group?:` justamente para que esto no pueda
    // pasar por descuido; el test cierra el círculo por si alguien escribe `null`
    // «para salir del paso» en una sección que sí tiene grupo.
    const sueltas = BACKOFFICE_SECTIONS.filter((s) => s.group === null);
    expect(sueltas.map((s) => s.id)).toEqual(['dashboard']);
    expect(sueltas[0].route).toBe(ADMIN_ROOT);
  });

  it('todo grupo declarado en una sección existe en BACKOFFICE_GROUPS', () => {
    const declarados = new Set(BACKOFFICE_GROUPS.map((g) => g.id));
    for (const section of BACKOFFICE_SECTIONS) {
      if (section.group === null) continue;
      expect(declarados.has(section.group)).toBe(true);
    }
  });

  it('no sobra ningún grupo: los seis tienen al menos una sección', () => {
    // Un grupo sin secciones es un título que nunca se pinta — o peor, la señal de que
    // alguien movió su contenido y olvidó la fila.
    for (const grupo of BACKOFFICE_GROUPS) {
      expect(BACKOFFICE_SECTIONS.some((s) => s.group === grupo.id)).toBe(true);
    }
  });

  it('un grupo VACÍO para un rol no se devuelve (un EDITOR no ve «Moderación»)', () => {
    const editor = navGroupsFor('EDITOR');
    expect(editor.groups.map((g) => g.id)).toEqual(['contenido', 'promocion']);
    // Y la raíz sí, porque el dashboard es EDITOR+.
    expect(editor.root.map((s) => s.id)).toEqual(['dashboard']);
  });

  it('3c: «Motivos de contacto» NO es de primer nivel, PERO sigue en el nav', () => {
    // Las dos mitades juntas, a propósito: la primera sola permitiría ocultarla y la
    // segunda sola permitiría dejarla donde estaba. Sólo las dos describen lo acordado.
    //
    // Y la prueba de que esto NO revierte R2: el aserto de abajo es el mismo que el de
    // «R3 CERRADO», sobre la misma función, sin tocarlo.
    const motivos = BACKOFFICE_SECTIONS.find((s) => s.id === 'motivos-contacto')!;
    expect(motivos.group).toBe('atencion');
    expect(navSectionsFor('MODERATOR').some((s) => s.id === 'motivos-contacto')).toBe(true);

    const nav = navGroupsFor('MODERATOR');
    expect(nav.root.some((s) => s.id === 'motivos-contacto')).toBe(false);
    const atencion = nav.groups.find((g) => g.id === 'atencion')!;
    expect(atencion.items.map((s) => s.id)).toEqual([
      'tickets',
      'mensajes-contacto',
      'motivos-contacto',
    ]);
  });

  it('3a: la raíz se llama «Resumen»', () => {
    expect(BACKOFFICE_SECTIONS.find((s) => s.id === 'dashboard')!.label).toBe('Resumen');
  });
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
