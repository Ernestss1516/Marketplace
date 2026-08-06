import { NavItemType, NavPageType, PostStatus, PostType } from '@prisma/client';
import { NavService } from './nav.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { RevalidateService } from '../../common/revalidate/revalidate.service';

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
      create: jest.fn().mockResolvedValue({ id: 'new-1', label: 'Nuevo', type: null, parentId: null }),
      update: jest.fn().mockResolvedValue({
        id: 'item-1',
        label: 'Editado',
        type: null,
        parentId: null,
        order: 0,
        active: true,
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    post: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  } as unknown as PrismaService;
}

function buildAuditLogStub() {
  return { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService;
}

function buildRevalidateStub() {
  return { revalidatePath: jest.fn(), revalidateTag: jest.fn() } as unknown as RevalidateService;
}

function buildService(prisma = buildPrismaStub()) {
  const auditLog = buildAuditLogStub();
  const revalidate = buildRevalidateStub();
  return { service: new NavService(prisma, auditLog, revalidate), prisma, auditLog, revalidate };
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

/**
 * Contrato del footer aplicado tal cual: NINGUNA mutación puede quedarse sin
 * AuditLog ni sin revalidar la caché. Son las 4 del CRUD, y se comprueban una a
 * una a propósito — es exactamente el tipo de olvido que no falla en desarrollo
 * (el nav simplemente se queda obsoleto hasta que expira el TTL de una hora).
 */
describe('NavService — auditoría y revalidación en TODAS las mutaciones', () => {
  const existingItem = {
    id: 'item-1',
    label: 'Ayuda',
    type: null,
    parentId: null,
    order: 0,
    active: true,
    pageId: null,
    url: null,
  };

  it('createItem registra NAV_ITEM_CREATE y revalida main-nav', async () => {
    const { service, auditLog, revalidate } = buildService();

    await service.createItem({ label: 'Nuevo' }, 'actor-1', '1.2.3.4');

    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'NAV_ITEM_CREATE', actorId: 'actor-1', resourceType: 'NavItem' }),
    );
    expect(revalidate.revalidateTag).toHaveBeenCalledWith('main-nav');
  });

  it('updateItem registra NAV_ITEM_UPDATE y revalida main-nav', async () => {
    const { service, prisma, auditLog, revalidate } = buildService();
    (prisma.navItem.findUnique as jest.Mock).mockResolvedValue(existingItem);

    await service.updateItem('item-1', { label: 'Editado' }, 'actor-1');

    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'NAV_ITEM_UPDATE', resourceId: 'item-1' }),
    );
    expect(revalidate.revalidateTag).toHaveBeenCalledWith('main-nav');
  });

  it('deleteItem registra NAV_ITEM_DELETE con el nº de descendientes y revalida main-nav', async () => {
    const { service, prisma, auditLog, revalidate } = buildService();
    (prisma.navItem.findUnique as jest.Mock).mockResolvedValue(existingItem);
    (prisma.navItem.count as jest.Mock).mockResolvedValue(3);

    await service.deleteItem('item-1', 'actor-1');

    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'NAV_ITEM_DELETE',
        // El cascade no lo cuenta nadie más: sin esto el borrado no sería
        // reconstruible desde el log.
        before: expect.objectContaining({ childCount: 3 }),
      }),
    );
    expect(revalidate.revalidateTag).toHaveBeenCalledWith('main-nav');
  });

  it('reorderItems registra NAV_ITEM_REORDER y revalida main-nav', async () => {
    const { service, auditLog, revalidate } = buildService();

    await service.reorderItems({ items: [{ id: 'a', order: 1 }, { id: 'b', order: 0 }] }, 'actor-1');

    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'NAV_ITEM_REORDER', resourceId: 'batch' }),
    );
    expect(revalidate.revalidateTag).toHaveBeenCalledWith('main-nav');
  });

  it('una mutación rechazada por validación NO audita ni revalida', async () => {
    const { service, auditLog, revalidate } = buildService();

    await expect(
      service.createItem({ label: 'Malo', type: NavItemType.PAGE }, 'actor-1'),
    ).rejects.toThrow('pageId es obligatorio cuando type=PAGE');

    expect(auditLog.log).not.toHaveBeenCalled();
    expect(revalidate.revalidateTag).not.toHaveBeenCalled();
  });
});

describe('NavService — escritura del destino discriminado', () => {
  it('cambiar de PAGE a INTERNAL limpia el pageId anterior (los 3 campos van juntos)', async () => {
    const { service, prisma } = buildService();
    (prisma.navItem.findUnique as jest.Mock).mockResolvedValue({
      id: 'item-1',
      label: 'Ayuda',
      type: NavItemType.PAGE,
      pageId: 'page-1',
      url: null,
      parentId: null,
      order: 0,
      active: true,
    });

    await service.updateItem('item-1', { type: NavItemType.INTERNAL, url: '/ayuda' }, 'actor-1');

    expect(prisma.navItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: NavItemType.INTERNAL, pageId: null, url: '/ayuda' }),
      }),
    );
  });

  it('type=null explícito quita el destino y deja el nodo como solo-desplegable', async () => {
    const { service, prisma } = buildService();
    (prisma.navItem.findUnique as jest.Mock).mockResolvedValue({
      id: 'item-1',
      label: 'Ayuda',
      type: NavItemType.INTERNAL,
      pageId: null,
      url: '/ayuda',
      parentId: null,
      order: 0,
      active: true,
    });

    await service.updateItem('item-1', { type: null }, 'actor-1');

    expect(prisma.navItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: null, pageId: null, url: null }),
      }),
    );
  });

  it('un update que no toca el destino no lo reescribe', async () => {
    const { service, prisma } = buildService();
    (prisma.navItem.findUnique as jest.Mock).mockResolvedValue({
      id: 'item-1',
      label: 'Ayuda',
      type: NavItemType.INTERNAL,
      pageId: null,
      url: '/ayuda',
      parentId: null,
      order: 0,
      active: true,
    });

    await service.updateItem('item-1', { label: 'Ayuda y soporte' }, 'actor-1');

    const data = (prisma.navItem.update as jest.Mock).mock.calls[0][0].data;
    expect(data).not.toHaveProperty('type');
    expect(data).not.toHaveProperty('url');
    expect(data).not.toHaveProperty('pageId');
  });
});
