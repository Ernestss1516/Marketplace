import { NavItemType, NavPageType, PostStatus, PostType } from '@prisma/client';
import { NavService } from './nav.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Tests del SERVICIO: la validación de destino (§2.3 del diseño) y las guardas
 * del árbol. El gate recursivo se prueba aparte, sobre la función pura, en
 * nav.types.spec.ts.
 *
 * Stub de Prisma en lugar de BD — mismo planteamiento que footer.service.spec.ts.
 */
function buildPrismaStub() {
  return {
    navItem: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    post: {
      findUnique: jest.fn(),
    },
  } as unknown as PrismaService;
}

function buildService(prisma = buildPrismaStub()) {
  return { service: new NavService(prisma), prisma };
}

describe('NavService — validación del destino (con destino)', () => {
  it('type=PAGE sin pageId → 400', () => {
    const { service } = buildService();
    expect(() => service.assertItemDestination(NavItemType.PAGE)).toThrow(
      'pageId es obligatorio cuando type=PAGE',
    );
  });

  it('type=PAGE con url además de pageId → 400', () => {
    const { service } = buildService();
    expect(() => service.assertItemDestination(NavItemType.PAGE, 'page-1', '/x')).toThrow(
      'url debe ir vacío cuando type=PAGE',
    );
  });

  it('type=PAGE con solo pageId → pasa', () => {
    const { service } = buildService();
    expect(() => service.assertItemDestination(NavItemType.PAGE, 'page-1')).not.toThrow();
  });

  it('type=INTERNAL sin url → 400', () => {
    const { service } = buildService();
    expect(() => service.assertItemDestination(NavItemType.INTERNAL)).toThrow(
      'url es obligatorio cuando type=INTERNAL',
    );
  });

  it('type=INTERNAL con url que no empieza por "/" → 400', () => {
    const { service } = buildService();
    expect(() =>
      service.assertItemDestination(NavItemType.INTERNAL, undefined, 'https://example.com'),
    ).toThrow('Una ruta interna debe empezar por "/"');
  });

  it('type=INTERNAL con pageId colado → 400', () => {
    const { service } = buildService();
    expect(() => service.assertItemDestination(NavItemType.INTERNAL, 'page-1', '/busqueda')).toThrow(
      'pageId debe ir vacío cuando type=INTERNAL',
    );
  });

  it('type=INTERNAL con ruta relativa → pasa', () => {
    const { service } = buildService();
    expect(() =>
      service.assertItemDestination(NavItemType.INTERNAL, undefined, '/busqueda'),
    ).not.toThrow();
  });

  it('type=EXTERNAL con url relativa (no absoluta) → 400', () => {
    const { service } = buildService();
    expect(() => service.assertItemDestination(NavItemType.EXTERNAL, undefined, '/busqueda')).toThrow(
      'url debe ser una URL absoluta (http/https) cuando type=EXTERNAL',
    );
  });

  it('type=EXTERNAL con esquema no http (javascript:) → 400', () => {
    const { service } = buildService();
    expect(() =>
      service.assertItemDestination(NavItemType.EXTERNAL, undefined, 'javascript:alert(1)'),
    ).toThrow('url debe ser una URL absoluta (http/https) cuando type=EXTERNAL');
  });

  it('type=EXTERNAL con URL absoluta https → pasa', () => {
    const { service } = buildService();
    expect(() =>
      service.assertItemDestination(NavItemType.EXTERNAL, undefined, 'https://example.com'),
    ).not.toThrow();
  });
});

describe('NavService — validación del destino OPCIONAL (la regla nueva, §2.3)', () => {
  it('type=null sin pageId ni url → SE ACEPTA (nodo solo-desplegable)', () => {
    const { service } = buildService();
    expect(() => service.assertItemDestination(null)).not.toThrow();
  });

  it('type ausente (undefined) → se acepta igual que null', () => {
    const { service } = buildService();
    expect(() => service.assertItemDestination(undefined)).not.toThrow();
  });

  it('type=null NO exige tener hijos ya: el padre nace antes que su primer hijo', () => {
    const { service, prisma } = buildService();
    // La regla "sin destino ⇒ debe tener hijos" se resuelve PODANDO al leer, no
    // rechazando al escribir — así que aquí no se consulta la BD siquiera.
    expect(() => service.assertItemDestination(null)).not.toThrow();
    expect(prisma.navItem.count).not.toHaveBeenCalled();
  });

  it('type=null con un pageId colado → 400 (destino fantasma)', () => {
    const { service } = buildService();
    expect(() => service.assertItemDestination(null, 'page-1')).toThrow(
      'pageId debe ir vacío en un nodo sin destino',
    );
  });

  it('type=null con una url colada → 400 (destino fantasma)', () => {
    const { service } = buildService();
    expect(() => service.assertItemDestination(null, undefined, '/busqueda')).toThrow(
      'url debe ir vacío en un nodo sin destino',
    );
  });
});

describe('NavService — destino PAGE contra un Post real', () => {
  it('pageId inexistente → 404', async () => {
    const { service, prisma } = buildService();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.assertPageDestination('nope')).rejects.toThrow('Página no encontrada');
  });

  it('pageId que apunta a un POST de blog → 400', async () => {
    const { service, prisma } = buildService();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue({ type: PostType.POST });
    await expect(service.assertPageDestination('post-1')).rejects.toThrow(
      'pageId debe apuntar a una página informativa (type=PAGE), no a un post de blog',
    );
  });

  it('página en DRAFT → SE ACEPTA (el gate decide en lectura, no esto)', async () => {
    const { service, prisma } = buildService();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue({ type: PostType.PAGE });
    await expect(service.assertPageDestination('page-1')).resolves.toBeUndefined();
  });
});

describe('NavService — tope de profundidad (NAV_MAX_DEPTH = 2)', () => {
  it('parentId null (nodo raíz) → pasa sin consultar nada', async () => {
    const { service, prisma } = buildService();
    await expect(service.assertMaxDepth(null)).resolves.toBeUndefined();
    expect(prisma.navItem.findUnique).not.toHaveBeenCalled();
  });

  it('colgar de una raíz → pasa', async () => {
    const { service, prisma } = buildService();
    (prisma.navItem.findUnique as jest.Mock).mockResolvedValue({ parentId: null, label: 'Ayuda' });
    await expect(service.assertMaxDepth('root-1')).resolves.toBeUndefined();
  });

  it('colgar de un nodo que YA es submenú → 400 (sería un tercer nivel)', async () => {
    const { service, prisma } = buildService();
    (prisma.navItem.findUnique as jest.Mock).mockResolvedValue({ parentId: 'root-1', label: 'Contacto' });
    await expect(service.assertMaxDepth('child-1')).rejects.toThrow(
      'No se puede colgar de "Contacto": ya es un submenú',
    );
  });

  it('padre inexistente → 404', async () => {
    const { service, prisma } = buildService();
    (prisma.navItem.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.assertMaxDepth('ghost')).rejects.toThrow('Menú padre no encontrado');
  });

  it('mover bajo una raíz un nodo QUE TIENE hijos → 400 (arrastraría nietos al tercer nivel)', async () => {
    const { service, prisma } = buildService();
    (prisma.navItem.findUnique as jest.Mock).mockResolvedValue({ parentId: null, label: 'Ayuda' });
    (prisma.navItem.count as jest.Mock).mockResolvedValue(2);
    await expect(service.assertMaxDepth('root-2', 'root-2')).rejects.toThrow(
      'No se puede convertir en submenú: tiene 2 submenú(s)',
    );
  });

  it('mover bajo una raíz un nodo SIN hijos → pasa', async () => {
    const { service, prisma } = buildService();
    (prisma.navItem.findUnique as jest.Mock).mockResolvedValue({ parentId: null, label: 'Ayuda' });
    (prisma.navItem.count as jest.Mock).mockResolvedValue(0);
    await expect(service.assertMaxDepth('root-2', 'root-2')).resolves.toBeUndefined();
  });
});

describe('NavService — guarda de ciclos', () => {
  it('colgar un nodo de sí mismo → 400', async () => {
    const { service } = buildService();
    await expect(service.assertNoCycle('a', 'a')).rejects.toThrow('Un menú no puede colgar de sí mismo');
  });

  it('colgar un nodo de su propio hijo → 400', async () => {
    const { service, prisma } = buildService();
    // El padre destino ('b') tiene como padre a 'a', el nodo que se mueve.
    (prisma.navItem.findUnique as jest.Mock).mockResolvedValue({ parentId: 'a' });
    await expect(service.assertNoCycle('a', 'b')).rejects.toThrow(
      'Un menú no puede colgar de uno de sus propios submenús',
    );
  });

  it('colgar de un nodo no emparentado → pasa', async () => {
    const { service, prisma } = buildService();
    (prisma.navItem.findUnique as jest.Mock).mockResolvedValue({ parentId: null });
    await expect(service.assertNoCycle('a', 'b')).resolves.toBeUndefined();
  });

  it('parentId null → pasa sin consultar nada', async () => {
    const { service, prisma } = buildService();
    await expect(service.assertNoCycle('a', null)).resolves.toBeUndefined();
    expect(prisma.navItem.findUnique).not.toHaveBeenCalled();
  });
});

describe('NavService — listPublicNav', () => {
  it('delega la poda al gate: filtra por tipo de página y resuelve el href server-side', async () => {
    const { service, prisma } = buildService();
    (prisma.navItem.findMany as jest.Mock).mockResolvedValue([
      {
        label: 'Ayuda',
        order: 0,
        active: true,
        type: null,
        url: null,
        page: null,
        visibleOn: [],
        children: [
          {
            label: 'Legal',
            order: 0,
            active: true,
            type: NavItemType.PAGE,
            url: null,
            page: { slug: 'legal', status: PostStatus.PUBLISHED },
            visibleOn: [NavPageType.HOME],
          },
        ],
      },
    ]);

    // En HOME el hijo pasa y arrastra al padre…
    await expect(service.listPublicNav(NavPageType.HOME)).resolves.toEqual([
      {
        label: 'Ayuda',
        href: null,
        external: false,
        children: [{ label: 'Legal', href: '/paginas/legal', external: false, children: [] }],
      },
    ]);

    // …y en BUSQUEDA no queda nada: la barra no se pintará.
    await expect(service.listPublicNav(NavPageType.BUSQUEDA)).resolves.toEqual([]);
  });

  it('sin ningún nodo en BD → [] (la barra no se renderiza)', async () => {
    const { service } = buildService();
    await expect(service.listPublicNav(NavPageType.HOME)).resolves.toEqual([]);
  });
});
