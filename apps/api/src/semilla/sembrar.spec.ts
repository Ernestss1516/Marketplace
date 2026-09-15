/**
 * BARRERAS 2 a 5 — LA SEMILLA DE PRODUCCIÓN, EJECUTADA DE VERDAD.
 *
 * Ver docs/auditoria-seed.md.
 *
 * ─── POR QUÉ ESTO SE PUEDE PROBAR, Y ANTES NO ───────────────────────────────────
 *
 * `seed.ts` tenía un `new PrismaClient()` en el módulo y un `main()` en la raíz: mirarlo
 * lo EJECUTABA, así que lo único comprobable era el texto del fichero. Ahora el cliente
 * es un parámetro y la llamada de abajo vive bajo `require.main`, de modo que aquí se
 * ejecuta la semilla **entera** —y dos veces— contra un doble en memoria: sin Postgres,
 * sin red y en milisegundos.
 *
 * Es la diferencia entre afirmar que el `update` está vacío y comprobar que **una
 * categoría que un administrador cambió sigue cambiada después de volver a sembrar**.
 *
 * ─── EL DOBLE ───────────────────────────────────────────────────────────────────
 *
 * Deliberadamente tonto: filas en un array y comparación por igualdad. No imita a Prisma,
 * imita lo POCO de Prisma que esta semilla usa. Si la semilla empezara a usar algo que el
 * doble no sabe hacer, este fichero fallaría con un error claro en vez de dar un falso
 * verde — que es justo la propiedad que se quiere de un doble.
 */

import type { PrismaClient } from '@prisma/client';

import { sembrar } from '../../prisma/seed';
import { MOTIVOS_CONTACTO, COLUMNAS_PIE, NAV_INICIAL } from '../../prisma/seed-datos-iniciales';
import { PAGINA_COOKIES_SLUG } from '../../prisma/seed-pagina-cookies';
import { SEED_SETTINGS } from '../../prisma/seed-settings';
import { VAR_EMAIL_ADMIN, VAR_PASSWORD_ADMIN } from '../../prisma/seed-admin';

// ── El doble ───────────────────────────────────────────────────────────────────

type Fila = Record<string, unknown> & { id: string };

class Tabla {
  readonly filas: Fila[] = [];
  private secuencia = 0;

  constructor(private readonly nombre: string) {}

  private id(): string {
    return `${this.nombre}-${++this.secuencia}`;
  }

  private coincide(fila: Fila, where: Record<string, unknown> = {}): boolean {
    return Object.entries(where).every(([clave, valor]) => fila[clave] === valor);
  }

  count(args?: { where?: Record<string, unknown> }): number {
    return this.filas.filter((f) => this.coincide(f, args?.where)).length;
  }

  findUnique(args: { where: Record<string, unknown> }): Fila | null {
    return this.filas.find((f) => this.coincide(f, args.where)) ?? null;
  }

  findFirst(args?: { where?: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'> }): Fila | null {
    const candidatas = this.filas.filter((f) => this.coincide(f, args?.where));
    const [campo, sentido] = Object.entries(args?.orderBy ?? {})[0] ?? [];
    if (!campo) return candidatas[0] ?? null;
    const ordenadas = [...candidatas].sort((a, b) =>
      String(a[campo]) < String(b[campo]) ? -1 : String(a[campo]) > String(b[campo]) ? 1 : 0,
    );
    return (sentido === 'desc' ? ordenadas.reverse() : ordenadas)[0] ?? null;
  }

  create(args: { data: Record<string, unknown> }): Fila {
    const fila: Fila = {
      id: (args.data.id as string) ?? this.id(),
      createdAt: new Date(Date.now() + this.filas.length),
      ...args.data,
    } as Fila;
    this.filas.push(fila);
    return fila;
  }

  createMany(args: { data: Record<string, unknown>[]; skipDuplicates?: boolean }): { count: number } {
    let count = 0;
    for (const data of args.data) {
      // `skipDuplicates` se resuelve contra la clave `key` porque es la única semilla
      // que lo usa (los ajustes). Si otra empezara a usarlo con otra clave única, el
      // doble mentiría — por eso está dicho aquí.
      if (args.skipDuplicates && this.filas.some((f) => f.key !== undefined && f.key === data.key)) {
        continue;
      }
      this.create({ data });
      count++;
    }
    return { count };
  }

  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Fila {
    const fila = this.findUnique({ where: args.where });
    if (!fila) throw new Error(`update sobre ${this.nombre} inexistente`);
    Object.assign(fila, args.data);
    return fila;
  }

  upsert(args: {
    where: Record<string, unknown>;
    update: Record<string, unknown>;
    create: Record<string, unknown>;
  }): Fila {
    const fila = this.findUnique({ where: args.where });
    if (fila) {
      Object.assign(fila, args.update);
      return fila;
    }
    return this.create({ data: args.create });
  }
}

const MODELOS = [
  'category',
  'user',
  'setting',
  'homepageConfig',
  'post',
  'contactReason',
  'footerColumn',
  'footerItem',
  'navItem',
  'product',
  'price',
  'creditPack',
  'bumpPack',
] as const;

type Base = Record<(typeof MODELOS)[number], Tabla>;

function nuevaBase(): Base {
  const base = {} as Base;
  for (const modelo of MODELOS) base[modelo] = new Tabla(modelo);
  return base;
}

/**
 * La fachada que ve la semilla: **las mismas tablas, pero asíncronas**.
 *
 * El doble es síncrono para que los casos puedan leerlo sin `await` en cada línea; la
 * semilla, en cambio, tiene que ejecutarse exactamente igual que contra Postgres, o no
 * estaríamos probando la semilla de verdad. El `Proxy` envuelve sólo los métodos —
 * `filas` sigue siendo el array de siempre, compartido entre las dos vistas.
 */
function comoPrisma(base: Base): PrismaClient {
  const fachada: Record<string, unknown> = {};
  for (const modelo of MODELOS) {
    const tabla = base[modelo];
    fachada[modelo] = new Proxy(tabla, {
      get(destino, prop, receptor) {
        const valor = Reflect.get(destino, prop, receptor);
        if (typeof valor !== 'function') return valor;
        return (...args: unknown[]) => Promise.resolve((valor as (...a: unknown[]) => unknown).apply(destino, args));
      },
    });
  }
  return fachada as unknown as PrismaClient;
}

// ── El entorno de las pruebas ──────────────────────────────────────────────────

const ENV_CON_CREDENCIAL: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  [VAR_EMAIL_ADMIN]: 'admin@ejemplo.test',
  [VAR_PASSWORD_ADMIN]: 'contrasena-larga-de-prueba',
};

const recuentos = (base: Base) =>
  Object.fromEntries(MODELOS.map((m) => [m, base[m].count()])) as Record<string, number>;

// La semilla habla por consola; aquí sólo ensucia la salida de Jest.
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('BARRERA 3 — una base recién migrada arranca con lo esencial', () => {
  let base: Base;

  beforeAll(async () => {
    base = nuevaBase();
    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);
  });

  it('las categorías (sin ellas no se puede ni publicar ni buscar)', () => {
    // 6 padres + 18 hijas.
    expect(base.category.count()).toBe(24);
    expect(base.category.findUnique({ where: { slug: 'coches' } })).toBeTruthy();
  });

  it('los motivos de contacto — el formulario público NO se apaga', () => {
    // El hueco más grave de la auditoría: sin una sola fila, /contacto se sustituye por
    // «El formulario no está disponible en este momento» (ContactForm.tsx:106-109) y no
    // hay forma de enviar un mensaje.
    expect(base.contactReason.count()).toBe(MOTIVOS_CONTACTO.length);
    expect(base.contactReason.findUnique({ where: { nombre: 'Consulta general' } })).toBeTruthy();
  });

  it('el pie, con sus columnas y sus enlaces', () => {
    expect(base.footerColumn.count()).toBe(COLUMNAS_PIE.length);
    expect(base.footerItem.count()).toBe(COLUMNAS_PIE.reduce((n, c) => n + c.items.length, 0));
  });

  it('la política de cookies queda enlazada desde el pie aunque siga en borrador', () => {
    // Publicar la página es lo único que hace falta para que el enlace aparezca: el pie
    // público filtra los PAGE no publicados (FooterService.listPublicNav). Nadie tiene
    // que acordarse de añadirlo después.
    const pagina = base.post.findUnique({ where: { slug: PAGINA_COOKIES_SLUG } });
    expect(pagina?.status).toBe('DRAFT');
    const item = base.footerItem.findUnique({ where: { type: 'PAGE' } });
    expect(item?.pageId).toBe(pagina?.id);
  });

  it('la barra de navegación (sin filas no se pinta nada)', () => {
    expect(base.navItem.count()).toBe(NAV_INICIAL.length);
  });

  it('los ajustes, la portada y el catálogo', () => {
    expect(base.setting.count()).toBe(SEED_SETTINGS.length);
    expect(base.homepageConfig.findUnique({ where: { id: 'singleton' } })).toBeTruthy();
    expect(base.product.count()).toBe(4);
    expect(base.creditPack.count()).toBe(3);
    expect(base.bumpPack.count()).toBe(3);
  });

  it('y el administrador, creado con la credencial del entorno', () => {
    const admin = base.user.findUnique({ where: { email: 'admin@ejemplo.test' } });
    expect(admin?.role).toBe('ADMIN');
    // El hash es un hash, no la contraseña.
    expect(admin?.passwordHash).not.toBe(ENV_CON_CREDENCIAL[VAR_PASSWORD_ADMIN]);
    expect(String(admin?.passwordHash)).toMatch(/^\$2[aby]\$/);
  });
});

describe('BARRERA 1 (comportamiento) — sin credencial no nace ningún administrador', () => {
  it('la semilla sigue con todo lo demás, pero no inventa una cuenta', async () => {
    const base = nuevaBase();
    await sembrar(comoPrisma(base), { NODE_ENV: 'production' });

    expect(base.user.count()).toBe(0);
    // Fail-safe, no fail-stop: el resto de la semilla es válido y se aplica.
    expect(base.category.count()).toBe(24);
    expect(base.contactReason.count()).toBe(MOTIVOS_CONTACTO.length);
    // La página de cookies necesita un autor, así que se queda para el próximo seed —
    // y el pie se siembra sin su enlace en vez de tumbar el despliegue.
    expect(base.post.count()).toBe(0);
    expect(base.footerColumn.count()).toBe(COLUMNAS_PIE.length);
  });
});

describe('BARRERA 2 — el rol de administrador no se re-fuerza en cada despliegue', () => {
  it('una cuenta que el operador degradó sigue degradada tras volver a sembrar', async () => {
    const base = nuevaBase();
    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);

    // El operador decide que esa cuenta ya no manda.
    base.user.update({
      where: { email: 'admin@ejemplo.test' },
      data: { role: 'USER', emailVerified: false },
    });

    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);

    const usuario = base.user.findUnique({ where: { email: 'admin@ejemplo.test' } });
    expect(usuario?.role).toBe('USER');
    expect(usuario?.emailVerified).toBe(false);
    expect(base.user.count()).toBe(1);
  });

  it('tampoco reescribe la contraseña de una cuenta existente', async () => {
    const base = nuevaBase();
    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);
    const antes = base.user.findUnique({ where: { email: 'admin@ejemplo.test' } })?.passwordHash;

    base.user.update({ where: { email: 'admin@ejemplo.test' }, data: { passwordHash: 'cambiada-a-mano' } });
    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);

    expect(base.user.findUnique({ where: { email: 'admin@ejemplo.test' } })?.passwordHash).toBe('cambiada-a-mano');
    expect(antes).not.toBe('cambiada-a-mano');
  });
});

describe('BARRERA 4 — las categorías se crean, pero no se revierten', () => {
  it('lo que el administrador cambió sigue cambiado tras volver a sembrar', async () => {
    const base = nuevaBase();
    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);

    // Un administrador renombra, reordena y le añade un atributo filtrable.
    const esquemaDelAdmin = [{ name: 'color', label: 'Color', type: 'text', filterable: true, required: false }];
    base.category.update({
      where: { slug: 'coches' },
      data: { name: 'Turismos', order: 99, attributeSchema: esquemaDelAdmin },
    });

    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);

    const coches = base.category.findUnique({ where: { slug: 'coches' } });
    expect(coches?.name).toBe('Turismos');
    expect(coches?.order).toBe(99);
    // El más caro de perder: arrastra los filterableAttributes del índice de Meilisearch.
    expect(coches?.attributeSchema).toEqual(esquemaDelAdmin);
  });

  it('pero una base nueva SÍ recibe el árbol base', async () => {
    // La otra mitad del trato: no revertir no puede significar no sembrar.
    const base = nuevaBase();
    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);
    expect(base.category.count()).toBe(24);
    expect(base.category.findUnique({ where: { slug: 'vehiculos' } })?.name).toBe('Vehículos');
  });

  it('y una categoría que alguien borró se vuelve a crear', async () => {
    const base = nuevaBase();
    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);
    const restantes = base.category.filas.filter((f) => f.slug !== 'motos');
    base.category.filas.length = 0;
    base.category.filas.push(...restantes);
    expect(base.category.count()).toBe(23);

    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);
    expect(base.category.count()).toBe(24);
  });
});

describe('BARRERA 5 — idempotente: re-ejecutar no duplica nada', () => {
  it('tres pasadas dejan exactamente las mismas filas que una', async () => {
    const base = nuevaBase();
    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);
    const trasLaPrimera = recuentos(base);

    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);
    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);

    expect(recuentos(base)).toEqual(trasLaPrimera);
  });

  it('y lo que un administrador editó después sigue en pie', async () => {
    const base = nuevaBase();
    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);

    // Los tres sitios que la auditoría comprobó protegidos, más los dos nuevos.
    base.setting.update({ where: { key: 'listingExpiryDays' }, data: { value: 15 } });
    base.homepageConfig.update({ where: { id: 'singleton' }, data: { blocks: [], updatedById: 'un-admin' } });
    base.footerColumn.update({ where: { name: 'Ayuda' }, data: { name: 'Soporte' } });
    base.contactReason.update({ where: { nombre: 'Prensa' }, data: { activo: false } });

    await sembrar(comoPrisma(base), ENV_CON_CREDENCIAL);

    expect(base.setting.findUnique({ where: { key: 'listingExpiryDays' } })?.value).toBe(15);
    expect(base.homepageConfig.findUnique({ where: { id: 'singleton' } })?.blocks).toEqual([]);
    expect(base.footerColumn.findUnique({ where: { name: 'Soporte' } })).toBeTruthy();
    expect(base.contactReason.findUnique({ where: { nombre: 'Prensa' } })?.activo).toBe(false);
  });
});
