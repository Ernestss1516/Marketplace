// RÁFAGA 2 (admin de categorías) — el refresco en caliente de filterableAttributes
// se encola SOLO cuando el payload toca attributeSchema, nunca cuando solo cambia
// allowedListingType (que no afecta a Meilisearch). Verificado aquí en aislamiento
// (mock de cola) — el efecto real sobre Meili se verifica en e2e (RÁFAGA 0/2).
import { AdminService } from './admin.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { RedisService } from '../../infra/redis/redis.service';
import type { MeilisearchService } from '../../infra/meilisearch/meilisearch.service';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { FilterableAttributesResolver } from '../search/filterable-attributes.resolver';

function buildService(prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {
    category: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'cat-1',
        name: 'Cat',
        slug: 'cat',
        parentId: null,
        allowedListingType: 'BOTH',
      }),
      create: jest.fn().mockResolvedValue({ id: 'cat-new', name: 'Nueva', slug: 'nueva', order: 0 }),
      update: jest.fn().mockResolvedValue({ id: 'cat-1', name: 'Cat', slug: 'cat', order: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    listing: {
      count: jest.fn().mockResolvedValue(0),
    },
    ...prismaOverrides,
  };
  const auditLog = { log: jest.fn().mockResolvedValue(undefined) };
  const indexingQueue = { add: jest.fn().mockResolvedValue(undefined) };

  const service = new AdminService(
    prisma as unknown as PrismaService,
    {} as RedisService,
    {} as MeilisearchService,
    auditLog as unknown as AuditLogService,
    {} as FilterableAttributesResolver,
    indexingQueue as never,
  );

  return { service, prisma, auditLog, indexingQueue };
}

describe('AdminService — refresco en caliente encolado solo cuando cambia attributeSchema', () => {
  it('createCategory CON attributeSchema encola refresh-filterable-attributes', async () => {
    const { service, indexingQueue } = buildService();

    await service.createCategory('actor-1', {
      name: 'Nueva',
      slug: 'nueva',
      attributeSchema: [{ name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false }],
    });

    expect(indexingQueue.add).toHaveBeenCalledWith('refresh-filterable-attributes', {});
  });

  it('createCategory SIN attributeSchema no encola nada', async () => {
    const { service, indexingQueue } = buildService();

    await service.createCategory('actor-1', { name: 'Nueva', slug: 'nueva' });

    expect(indexingQueue.add).not.toHaveBeenCalled();
  });

  it('updateCategory CON attributeSchema encola refresh-filterable-attributes', async () => {
    const { service, indexingQueue } = buildService();

    await service.updateCategory('cat-1', 'actor-1', {
      attributeSchema: [{ name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false }],
    });

    expect(indexingQueue.add).toHaveBeenCalledWith('refresh-filterable-attributes', {});
  });

  it('updateCategory cambiando SOLO allowedListingType no encola nada', async () => {
    const { service, indexingQueue } = buildService();

    await service.updateCategory('cat-1', 'actor-1', { allowedListingType: 'PRODUCT_ONLY' });

    expect(indexingQueue.add).not.toHaveBeenCalled();
  });

  it('updateCategory cambiando solo name/order no encola nada', async () => {
    const { service, indexingQueue } = buildService();

    await service.updateCategory('cat-1', 'actor-1', { name: 'Renombrada' });

    expect(indexingQueue.add).not.toHaveBeenCalled();
  });
});

describe('AdminService — el chequeo "hacia abajo" solo consulta hijos/anuncios si la política REALMENTE cambia', () => {
  it('editar name/schema sin allowedListingType → NO consulta children ni listing.count', async () => {
    const { service, prisma } = buildService();

    await service.updateCategory('cat-1', 'actor-1', {
      name: 'Renombrada',
      attributeSchema: [{ name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false }],
    });

    expect(prisma.category.findMany).not.toHaveBeenCalled();
    expect(prisma.listing.count).not.toHaveBeenCalled();
  });

  it('enviar allowedListingType IGUAL al ya persistido (BOTH → BOTH) → NO consulta children ni listing.count', async () => {
    const { service, prisma } = buildService(); // findUnique mock persiste allowedListingType: 'BOTH'

    await service.updateCategory('cat-1', 'actor-1', { allowedListingType: 'BOTH' });

    expect(prisma.category.findMany).not.toHaveBeenCalled();
    expect(prisma.listing.count).not.toHaveBeenCalled();
  });

  it('cambiar la política de verdad (BOTH → PRODUCT_ONLY) → SÍ consulta children y listing.count', async () => {
    const { service, prisma } = buildService();

    await service.updateCategory('cat-1', 'actor-1', { allowedListingType: 'PRODUCT_ONLY' });

    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { parentId: 'cat-1' } }),
    );
    expect(prisma.listing.count).toHaveBeenCalled();
  });

  it('ensanchar a BOTH → NO consulta children ni listing.count (ensanchar nunca rompe)', async () => {
    const { service, prisma } = buildService({
      category: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cat-1', name: 'Cat', slug: 'cat', parentId: null, allowedListingType: 'PRODUCT_ONLY',
        }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'cat-1', name: 'Cat', slug: 'cat', order: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      listing: { count: jest.fn().mockResolvedValue(0) },
    });

    await service.updateCategory('cat-1', 'actor-1', { allowedListingType: 'BOTH' });

    expect(prisma.category.findMany).not.toHaveBeenCalled();
    expect(prisma.listing.count).not.toHaveBeenCalled();
  });
});
