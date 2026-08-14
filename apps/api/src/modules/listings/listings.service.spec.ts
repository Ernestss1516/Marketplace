import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ListingsService } from './listings.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { RedisService } from '../../infra/redis/redis.service';
import type { RateLimitService } from '../../infra/redis/rate-limit.service';
import type { BadWordService } from '../moderation/bad-word.service';
import type { EntitlementService } from '../billing/entitlement.service';
import type { ListingActivationService } from '../listing-activation/listing-activation.service';
import type { MessagingService } from '../messaging/messaging.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { ReviewsService } from '../reviews/reviews.service';
import type { TagsService } from '../tags/tags.service';
import type { CategoryTreeService } from '../categories/category-tree.service';
import type { ListingGateService } from '../listing-gate/listing-gate.service';
import type { RevalidationService } from '../listing-gate/revalidation.service';
import type { AttributeCheckService } from '../listing-gate/attribute-check.service';
import type { CreateListingDto } from './dto/create-listing.dto';

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`slug`)', {
    code: 'P2002',
    clientVersion: '6.2.1',
  });
}

function buildDto(): CreateListingDto {
  return {
    title: 'Bicicleta de montaña',
    description: 'Poco uso, buen estado',
    price: 250,
    type: 'PRODUCT',
    priceType: 'FIXED',
    categoryId: 'cat-1',
    city: 'Madrid',
    province: 'Madrid',
  } as CreateListingDto;
}

describe('ListingsService.create — reintento de slug ante P2002', () => {
  let prisma: { category: { findUnique: jest.Mock }; listing: { create: jest.Mock } };
  let indexingQueue: { add: jest.Mock };
  let service: ListingsService;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    prisma = {
      category: {
        findUnique: jest.fn().mockResolvedValue({
          // B2 — create() pide el slug para resolver los tags efectivos.
          slug: 'bicicletas',
          attributeSchema: [],
          allowedListingType: 'BOTH',
          // columna NOT NULL, siempre presente en selects reales (el mock debe
          // reflejar la forma real de la categoría, no una parcial).
          allowedPriceUnits: [],
          parent: null,
        }),
      },
      listing: { create: jest.fn() },
    };
    indexingQueue = { add: jest.fn().mockResolvedValue(undefined) };
    service = new ListingsService(
      prisma as unknown as PrismaService,
      {} as RedisService,
      {} as RateLimitService,
      indexingQueue as never,
      { add: jest.fn().mockResolvedValue(undefined) } as never,
      {} as BadWordService,
      {} as EntitlementService,
      {} as ListingActivationService,
      {} as MessagingService,
      {} as NotificationsService,
      {} as ReviewsService,
      // B2 — este spec va del reintento de slug, no de los tags: el dto no los lleva,
      // así que basta con que la resolución devuelva la lista vacía.
      { resolveTagsForListing: jest.fn().mockResolvedValue([]) } as unknown as TagsService,
      // PROFUNDIDAD N — RÁFAGA 1: mantenimiento de fixture por cambio de FIRMA.
      // create() ya no consulta la categoría por Prisma: pide su CADENA de
      // ancestros al único lector. Este spec va del reintento de slug ante un
      // P2002, así que basta una cadena de un nodo con la misma forma que antes
      // devolvía el `findUnique` mockeado. Ninguna aserción cambia.
      {
        getAncestorChain: jest.fn().mockResolvedValue([
          {
            id: 'cat-1',
            slug: 'bicicletas',
            name: 'Bicicletas',
            parentId: null,
            attributeSchema: [],
            allowedListingType: 'BOTH',
            allowedViews: [],
            defaultView: null,
            allowedPriceUnits: [],
          },
        ]),
      } as unknown as CategoryTreeService,
      // PUERTA — mantenimiento de fixture. `create()` SÍ pasa por la puerta desde
      // la regla del límite total (`assertCanCreate`), aunque no por la parte que
      // valida transiciones a ACTIVE (crear deja el anuncio en DRAFT). Este spec
      // va del reintento de slug ante un P2002, así que la puerta deja pasar.
      {
        assertCanBecomeActive: jest.fn(),
        assertCanCreate: jest.fn(),
      } as unknown as ListingGateService,
      // PUERTA RÁFAGA 2 — mantenimiento de fixture por cambio de FIRMA. create()
      // no limpia ningún aviso: un anuncio recién creado nace sin marcar.
      { clearIfCompliant: jest.fn() } as unknown as RevalidationService,
      { issuesForMany: jest.fn().mockResolvedValue(new Map()) } as unknown as AttributeCheckService,
    );
    errorSpy = jest.spyOn((service as unknown as { logger: { error: (...a: unknown[]) => void } }).logger, 'error');
  });

  it('reintenta con un nuevo slug tras un P2002 y crea el anuncio en el 2º intento', async () => {
    const created = { id: 'listing-1', slug: 'bicicleta-de-montana-abc123' };
    prisma.listing.create.mockRejectedValueOnce(p2002()).mockResolvedValueOnce(created);

    const result = await service.create('seller-1', buildDto());

    expect(result).toEqual(created);
    expect(prisma.listing.create).toHaveBeenCalledTimes(2);
    // Cada intento usa un slug distinto (nuevo sufijo aleatorio) para el mismo título.
    const slugs = prisma.listing.create.mock.calls.map((call) => call[0].data.slug);
    expect(new Set(slugs).size).toBe(2);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('lanza ConflictException SLUG_GENERATION_FAILED tras agotar los 5 intentos, todos P2002', async () => {
    prisma.listing.create.mockRejectedValue(p2002());

    await expect(service.create('seller-1', buildDto())).rejects.toMatchObject({
      constructor: ConflictException,
      response: { code: 'SLUG_GENERATION_FAILED' },
    });
    expect(prisma.listing.create).toHaveBeenCalledTimes(5);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('relanza cualquier otro error de Prisma sin reintentar', async () => {
    const otherError = new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
      code: 'P2003',
      clientVersion: '6.2.1',
    });
    prisma.listing.create.mockRejectedValue(otherError);

    await expect(service.create('seller-1', buildDto())).rejects.toBe(otherError);
    expect(prisma.listing.create).toHaveBeenCalledTimes(1);
  });
});
