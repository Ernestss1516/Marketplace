/**
 * Unit test (Stripe mocked) — H8 Bloque D fase 4.
 *
 * Stripe checkout is Pro-subscription only now: one-time featured-listing
 * purchases used to go through here too (removed, see billing.processor.ts
 * git history) — Redsys is the only card channel for destacado. This is the
 * one place that can assert "Pro checkout still reaches Stripe" without
 * hitting the real network, since the project has no e2e Stripe-mocking
 * infra (see test/billing-rf6.e2e-spec.ts for the HTTP-level 400 coverage).
 */
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { ProductType } from '@prisma/client';
import { BillingService } from './billing.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { EntitlementService } from './entitlement.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';

const mockSessionsCreate = jest.fn();
const mockCustomersCreate = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: mockSessionsCreate } },
    customers: { create: mockCustomersCreate },
  })),
);

describe('BillingService.createCheckoutSession — Stripe destacado cerrado', () => {
  let service: BillingService;
  let prisma: {
    price: { findUnique: jest.Mock };
    user: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    subscription: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    mockSessionsCreate.mockReset();
    mockCustomersCreate.mockReset();

    prisma = {
      price: { findUnique: jest.fn() },
      user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      // UXV.6 (M4) — el guard de suscripción duplicada consulta si ya hay una vigente
      // antes de llamar a Stripe. `null` = este usuario no la tiene, que es la premisa de
      // los casos de aquí. El guard en sí se ejercita en test/uxv6-pro-guard.e2e-spec.ts,
      // contra la base de datos real.
      subscription: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: EntitlementService, useValue: {} },
        { provide: CampaignsService, useValue: {} },
        // UXV.1 (A2) — BillingService.bump invalida la ficha cacheada al terminar.
        // Este spec no ejercita bump (solo el checkout de Stripe), pero la dependencia
        // tiene que resolverse para que el módulo compile.
        { provide: RedisService, useValue: { client: { del: jest.fn() } } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: unknown) =>
              key === 'stripe.secretKey' ? 'sk_test_fake' : def,
            ),
          },
        },
        { provide: getQueueToken(QUEUE_INDEXING), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(BillingService);
  });

  it('rechaza un Price ONE_TIME (destacado) con 400 explícito, sin llamar a Stripe', async () => {
    prisma.price.findUnique.mockResolvedValue({
      id: 'price-featured',
      active: true,
      product: { type: ProductType.ONE_TIME },
      gatewayPriceId: 'price_stripe_featured',
    });

    await expect(
      service.createCheckoutSession('user-1', { priceId: 'price-featured' }),
    ).rejects.toThrow(BadRequestException);

    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('un Price RECURRING (Plan Pro) SIGUE funcionando: llega a Stripe en modo subscription', async () => {
    prisma.price.findUnique.mockResolvedValue({
      id: 'price-pro',
      active: true,
      product: { type: ProductType.RECURRING },
      gatewayPriceId: 'price_stripe_pro',
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: 'user-1',
      email: 'seller@example.com',
      name: 'Seller',
      stripeCustomerId: 'cus_existing',
    });
    mockSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/xyz' });

    const result = await service.createCheckoutSession('user-1', { priceId: 'price-pro' });

    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/pay/xyz');
    expect(mockCustomersCreate).not.toHaveBeenCalled(); // already had stripeCustomerId
    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_existing',
        subscription_data: expect.objectContaining({
          metadata: { userId: 'user-1', priceId: 'price-pro' },
        }),
      }),
    );
  });

  it('un priceId inexistente o inactivo → 404, sin llamar a Stripe', async () => {
    prisma.price.findUnique.mockResolvedValue(null);

    await expect(
      service.createCheckoutSession('user-1', { priceId: 'nope' }),
    ).rejects.toThrow(NotFoundException);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });
});
