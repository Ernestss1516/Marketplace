import { FooterItemType, PostType } from '@prisma/client';
import { FooterService } from './footer.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { RevalidateService } from '../../common/revalidate/revalidate.service';

function buildPrismaStub() {
  return {
    footerColumn: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    footerItem: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
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
  return { service: new FooterService(prisma, auditLog, revalidate), prisma, auditLog, revalidate };
}

describe('FooterService — validación del destino discriminado', () => {
  it('createItem type=PAGE sin pageId → 400', async () => {
    const { service } = buildService();
    await expect(
      service.createItem(
        { columnId: 'col-1', label: 'Ayuda', type: FooterItemType.PAGE } as never,
        'actor-1',
      ),
    ).rejects.toThrow('pageId es obligatorio cuando type=PAGE');
  });

  it('createItem type=PAGE con url además de pageId → 400', async () => {
    const { service, prisma } = buildService();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue({ type: PostType.PAGE });
    await expect(
      service.createItem(
        { columnId: 'col-1', label: 'Ayuda', type: FooterItemType.PAGE, pageId: 'page-1', url: '/x' } as never,
        'actor-1',
      ),
    ).rejects.toThrow('url debe ir vacío cuando type=PAGE');
  });

  it('createItem type=INTERNAL con URL absoluta (no ruta) → 400', async () => {
    const { service } = buildService();
    await expect(
      service.createItem(
        { columnId: 'col-1', label: 'Externo', type: FooterItemType.INTERNAL, url: 'https://example.com' } as never,
        'actor-1',
      ),
    ).rejects.toThrow('Una ruta interna debe empezar por "/"');
  });

  it('createItem type=INTERNAL sin url → 400', async () => {
    const { service } = buildService();
    await expect(
      service.createItem(
        { columnId: 'col-1', label: 'Externo', type: FooterItemType.INTERNAL } as never,
        'actor-1',
      ),
    ).rejects.toThrow('url es obligatorio cuando type=INTERNAL');
  });

  it('createItem type=EXTERNAL con ruta relativa (no URL absoluta) → 400', async () => {
    const { service } = buildService();
    await expect(
      service.createItem(
        { columnId: 'col-1', label: 'Externo', type: FooterItemType.EXTERNAL, url: '/busqueda' } as never,
        'actor-1',
      ),
    ).rejects.toThrow('url debe ser una URL absoluta');
  });

  it('createItem type=EXTERNAL con pageId además de url → 400', async () => {
    const { service } = buildService();
    await expect(
      service.createItem(
        {
          columnId: 'col-1',
          label: 'Externo',
          type: FooterItemType.EXTERNAL,
          url: 'https://example.com',
          pageId: 'page-1',
        } as never,
        'actor-1',
      ),
    ).rejects.toThrow('pageId debe ir vacío cuando type=EXTERNAL');
  });

  it('createItem type=PAGE con pageId de un POST (no PAGE) → 400', async () => {
    const { service, prisma } = buildService();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue({ type: PostType.POST });
    await expect(
      service.createItem(
        { columnId: 'col-1', label: 'Ayuda', type: FooterItemType.PAGE, pageId: 'post-1' } as never,
        'actor-1',
      ),
    ).rejects.toThrow('type=PAGE');
  });

  it('createItem type=PAGE con pageId inexistente → 404', async () => {
    const { service, prisma } = buildService();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      service.createItem(
        { columnId: 'col-1', label: 'Ayuda', type: FooterItemType.PAGE, pageId: 'no-existe' } as never,
        'actor-1',
      ),
    ).rejects.toThrow('Página no encontrada');
  });

  it('createItem con los 3 destinos válidos → crea sin error', async () => {
    const { service, prisma } = buildService();
    (prisma.post.findUnique as jest.Mock).mockResolvedValue({ type: PostType.PAGE });
    (prisma.footerItem.create as jest.Mock).mockImplementation(({ data }) => Promise.resolve({ id: 'item-1', ...data }));

    await expect(
      service.createItem(
        { columnId: 'col-1', label: 'Legal', type: FooterItemType.PAGE, pageId: 'page-1' } as never,
        'actor-1',
      ),
    ).resolves.toMatchObject({ pageId: 'page-1', url: null });

    await expect(
      service.createItem(
        { columnId: 'col-1', label: 'Buscar', type: FooterItemType.INTERNAL, url: '/busqueda' } as never,
        'actor-1',
      ),
    ).resolves.toMatchObject({ url: '/busqueda', pageId: null });

    await expect(
      service.createItem(
        { columnId: 'col-1', label: 'Blog externo', type: FooterItemType.EXTERNAL, url: 'https://example.com' } as never,
        'actor-1',
      ),
    ).resolves.toMatchObject({ url: 'https://example.com', pageId: null });
  });
});

describe('FooterService — updateItem: tocar el destino exige la combinación completa', () => {
  it('editar solo columnId (mover de columna) NO valida el destino', async () => {
    const { service, prisma } = buildService();
    (prisma.footerItem.findUnique as jest.Mock).mockResolvedValue({
      id: 'item-1', label: 'X', type: FooterItemType.PAGE, pageId: 'page-1', url: null, columnId: 'col-1', order: 0,
    });
    (prisma.footerItem.update as jest.Mock).mockResolvedValue({ id: 'item-1', columnId: 'col-2' });

    await expect(
      service.updateItem('item-1', { columnId: 'col-2' } as never, 'actor-1'),
    ).resolves.toBeDefined();
    expect(prisma.post.findUnique).not.toHaveBeenCalled();
  });

  it('cambiar type sin proveer el nuevo destino → 400', async () => {
    const { service, prisma } = buildService();
    (prisma.footerItem.findUnique as jest.Mock).mockResolvedValue({
      id: 'item-1', label: 'X', type: FooterItemType.PAGE, pageId: 'page-1', url: null, columnId: 'col-1', order: 0,
    });

    await expect(
      service.updateItem('item-1', { type: FooterItemType.EXTERNAL } as never, 'actor-1'),
    ).rejects.toThrow('url es obligatorio cuando type=EXTERNAL');
  });
});

describe('FooterService — reorder y borrado de columna', () => {
  it('reorderColumns hace un $transaction con los updates y revalida footer-nav', async () => {
    const { service, prisma, revalidate } = buildService();

    await service.reorderColumns(
      { items: [{ id: 'col-1', order: 1 }, { id: 'col-2', order: 0 }] } as never,
      'actor-1',
    );

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(revalidate.revalidateTag).toHaveBeenCalledWith('footer-nav');
  });

  it('deleteColumn borra la columna (cascade a sus items vía FK) y revalida footer-nav', async () => {
    const { service, prisma, revalidate } = buildService();
    (prisma.footerColumn.findUnique as jest.Mock).mockResolvedValue({ id: 'col-1', name: 'Legal', order: 0 });
    (prisma.footerItem.count as jest.Mock).mockResolvedValue(3);

    await service.deleteColumn('col-1', 'actor-1');

    expect(prisma.footerColumn.delete).toHaveBeenCalledWith({ where: { id: 'col-1' } });
    expect(revalidate.revalidateTag).toHaveBeenCalledWith('footer-nav');
  });
});
