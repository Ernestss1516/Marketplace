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
import type { CategoryTreeService } from '../categories/category-tree.service';
import type { ListingGateService } from '../listing-gate/listing-gate.service';

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
  // PROFUNDIDAD N — RÁFAGA 2: mantenimiento de fixture por cambio de MECANISMO.
  // Los guards «hacia abajo» ya no preguntan a Prisma por los hijos directos
  // (`where: { parentId }`): piden los DESCENDIENTES al único lector de la
  // jerarquía. Lo que este spec comprueba —que el chequeo caro sólo corre cuando
  // la política CAMBIA de verdad— no cambia; cambia dónde se observa.
  const categoryTree = {
    invalidate: jest.fn(),
    getDescendantIds: jest.fn().mockResolvedValue([]),
    getChildren: jest.fn().mockResolvedValue([]),
    getAncestorChain: jest.fn().mockResolvedValue([]),
    getDepth: jest.fn().mockResolvedValue(1),
  };

  const service = new AdminService(
    prisma as unknown as PrismaService,
    {} as RedisService,
    {} as MeilisearchService,
    auditLog as unknown as AuditLogService,
    {} as FilterableAttributesResolver,
    categoryTree as unknown as CategoryTreeService,
    // PUERTA — mantenimiento de fixture por cambio de FIRMA. Este spec ejercita
    // los guards de política de CATEGORÍA, que no tocan la puerta.
    { assertCanBecomeActive: jest.fn() } as unknown as ListingGateService,
    indexingQueue as never,
    // PUERTA ráfaga 2 — la cola del marcado. Estos casos no llegan a encolar
    // (ninguno cambia el `attributeSchema`), pero el constructor la exige.
    { add: jest.fn().mockResolvedValue(undefined) } as never,
    // BORRADO B3 — la cola de limpieza de R2 y el propio R2. Mismo mantenimiento
    // de fixture por cambio de firma: estos casos son de categorías y no borran
    // ningún anuncio, pero el constructor las exige.
    { add: jest.fn().mockResolvedValue(undefined) } as never,
    { getPublicUrl: () => 'https://cdn.test/' } as never,
  );

  return { service, prisma, auditLog, indexingQueue, categoryTree };
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
  it('editar name/schema sin allowedListingType → NO consulta listing.count (el chequeo de política no corre)', async () => {
    const { service, prisma, categoryTree } = buildService();

    await service.updateCategory('cat-1', 'actor-1', {
      name: 'Renombrada',
      attributeSchema: [{ name: 'brand', label: 'Marca', type: 'text', filterable: true, required: false }],
    });

    // Los descendientes SÍ se piden — no por el chequeo de política (que este test
    // verifica que no corre), sino por assertCardAttributeChangeDoesNotBreakChildren
    // (ATRIBUTOS EN CARD, bug 2): editar attributeSchema siempre comprueba si el
    // cambio rompería el tope de card de algún descendiente. Los dos chequeos
    // recorren la descendencia por razones distintas; `listing.count` sigue siendo
    // exclusivo del chequeo de política, y por eso sigue sin llamarse aquí.
    expect(categoryTree.getDescendantIds).toHaveBeenCalledWith('cat-1');
    expect(prisma.listing.count).not.toHaveBeenCalled();
  });

  it('enviar allowedListingType IGUAL al ya persistido (BOTH → BOTH) → NO consulta descendientes ni listing.count', async () => {
    const { service, prisma, categoryTree } = buildService(); // findUnique mock persiste allowedListingType: 'BOTH'

    await service.updateCategory('cat-1', 'actor-1', { allowedListingType: 'BOTH' });

    expect(categoryTree.getDescendantIds).not.toHaveBeenCalled();
    expect(prisma.listing.count).not.toHaveBeenCalled();
  });

  it('cambiar la política de verdad (BOTH → PRODUCT_ONLY) → SÍ consulta descendientes y listing.count', async () => {
    const { service, prisma, categoryTree } = buildService();

    await service.updateCategory('cat-1', 'actor-1', { allowedListingType: 'PRODUCT_ONLY' });

    expect(categoryTree.getDescendantIds).toHaveBeenCalledWith('cat-1');
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
