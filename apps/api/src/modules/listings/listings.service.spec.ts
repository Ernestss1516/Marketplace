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
