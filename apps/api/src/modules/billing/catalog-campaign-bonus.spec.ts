/**
 * BARRERA 1 (lado servidor) — EL CATÁLOGO EXPONE LA CAMPAÑA, PARA QUE SE VEA ANTES DE PAGAR.
 *
 * EL DEFECTO QUE ESTOS CASOS FIJAN: `getActiveCreditBonusCampaign()` tenía un ÚNICO llamador
 * en todo el repositorio —el checkout, o sea DESPUÉS de pulsar «Comprar»—. El bonus se
 * aplicaba, se congelaba y se acreditaba, pero el usuario compraba a ciegas y sólo lo
 * descubría luego, en el historial. La campaña era invisible justo cuando tendría que
 * convencer.
 *
 * Se prueba AQUÍ, en unitario con Prisma y CampaignsService dobles, y no en e2e: el e2e de
 * `/mis-creditos` corre contra los datos sembrados del backend real (su propia cabecera lo
 * documenta), así que fabricar una campaña viva con fechas controladas y comprobar el
 * payload exacto es trabajo de este nivel.
 *
 * Ver docs/auditoria-mis-creditos.md §6 (ráfaga A, paso 2) y §7 (barreras 1, 4, 5 y 7).
 */
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { CampaignType, ProductType } from '@prisma/client';
import { BillingService } from './billing.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { ListingGateService } from '../listing-gate/listing-gate.service';
import { EntitlementService } from './entitlement.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';

jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));

/** Un producto de packs de créditos (100 cr.) y otro de packs de bumps (20 bumps). */
const PRODUCTOS = [
  {
    id: 'prod-creditos',
    name: 'Créditos',
    description: null,
    type: ProductType.ONE_TIME,
    prices: [
      {
        id: 'price-cr',
        amount: 9.99,
        currency: 'EUR',
        interval: null,
        intervalCount: null,
        durationDays: null,
        creditPack: { id: 'cp1', name: 'Pack 100', creditAmount: 100 },
        bumpPack: null,
      },
    ],
  },
  {
    id: 'prod-bumps',
    name: 'Bumps',
    description: null,
    type: ProductType.ONE_TIME,
    prices: [
      {
        id: 'price-bp',
        amount: 4.99,
        currency: 'EUR',
        interval: null,
        intervalCount: null,
        durationDays: null,
        creditPack: null,
        bumpPack: { id: 'bp1', name: '20 bumps', bumpAmount: 20 },
      },
    ],
  },
];

const campana = (name: string, kind: 'PERCENT' | 'FIXED', value: number) => ({
  id: `camp-${name}`,
  name,
  type: CampaignType.CREDIT_BONUS,
  active: true,
  startsAt: new Date('2026-08-01'),
  endsAt: new Date('2026-09-15'),
  params: { kind, value },
});

describe('BillingService.getCatalog — el bonus de campaña, visible antes de comprar', () => {
  let service: BillingService;
  let campaigns: {
    getActiveActionDiscount: jest.Mock;
    getActiveCreditBonusCampaign: jest.Mock;
    getActiveBumpBonusCampaign: jest.Mock;
  };

  async function build() {
    const prisma = {
      product: { findMany: jest.fn().mockResolvedValue(PRODUCTOS) },
      // Sin filas de Setting: todos los ajustes caen a sus valores por defecto, incluidos
      // los dos porcentajes de Pro (20 %). Es suficiente y deja los casos legibles.
      setting: { findMany: jest.fn().mockResolvedValue([]) },
    };
    campaigns = {
      getActiveActionDiscount: jest.fn().mockResolvedValue(null),
      getActiveCreditBonusCampaign: jest.fn().mockResolvedValue(null),
      getActiveBumpBonusCampaign: jest.fn().mockResolvedValue(null),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: EntitlementService, useValue: {} },
        { provide: CampaignsService, useValue: campaigns },
        { provide: RedisService, useValue: { client: { del: jest.fn() } } },
        { provide: ListingGateService, useValue: { assertCanBePromotedById: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn((_k: string, d?: unknown) => d) } },
        { provide: getQueueToken(QUEUE_INDEXING), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(BillingService);
  }

  const packDeCreditos = (catalogo: Awaited<ReturnType<BillingService['getCatalog']>>) =>
    catalogo.products.find((p) => p.id === 'prod-creditos')!.prices[0] as Record<string, unknown>;
  const packDeBumps = (catalogo: Awaited<ReturnType<BillingService['getCatalog']>>) =>
    catalogo.products.find((p) => p.id === 'prod-bumps')!.prices[0] as Record<string, unknown>;

  beforeEach(build);

  it('BARRERA 5 — SIN campaña, el payload es el de antes: ni bonus por pack ni contexto', async () => {
    const catalogo = await service.getCatalog();

    expect(packDeCreditos(catalogo)).not.toHaveProperty('campaignBonusAmount');
    expect(packDeBumps(catalogo)).not.toHaveProperty('campaignBonusAmount');
    expect(catalogo).not.toHaveProperty('creditBonusCampaign');
    expect(catalogo).not.toHaveProperty('bumpBonusCampaign');
    // Y lo que ya existía sigue en su sitio: esta ráfaga añade, no reemplaza.
    expect(packDeCreditos(catalogo).proBonusAmount).toBe(20);
  });

  it('BARRERA 1 — con campaña PERCENT activa, cada pack trae su bonus resuelto', async () => {
    campaigns.getActiveCreditBonusCampaign.mockResolvedValue(
      campana('Vuelta al cole', 'PERCENT', 20),
    );

    const catalogo = await service.getCatalog();

    // 100 al 20 % = 20. Ya calculado por el servidor: la lista NO tiene que multiplicar.
    expect(packDeCreditos(catalogo).campaignBonusAmount).toBe(20);
  });

  it('BARRERA 1 — y el CONTEXTO: cómo se llama y hasta cuándo dura', async () => {
    campaigns.getActiveCreditBonusCampaign.mockResolvedValue(
      campana('Vuelta al cole', 'PERCENT', 20),
    );

    const catalogo = await service.getCatalog();

    // Sin esto, un «+20» aparecería en la tarjeta sin causa ni plazo.
    expect(catalogo.creditBonusCampaign).toEqual({
      name: 'Vuelta al cole',
      endsAt: new Date('2026-09-15'),
    });
  });

  it('BARRERA 4 — el número sale de la MISMA fórmula que congela el checkout (FIXED incluido)', async () => {
    campaigns.getActiveCreditBonusCampaign.mockResolvedValue(campana('Fija', 'FIXED', 50));

    const catalogo = await service.getCatalog();

    // FIXED devuelve `value` tal cual, sin escalar con el tamaño del pack — igual que hace
    // createCreditPackCheckout, porque es literalmente la misma función.
    expect(packDeCreditos(catalogo).campaignBonusAmount).toBe(50);
  });

  it('BARRERA 3 — el bonus Pro NO se toca: los dos viajan, y se suman', async () => {
    campaigns.getActiveCreditBonusCampaign.mockResolvedValue(
      campana('Vuelta al cole', 'PERCENT', 20),
    );

    const catalogo = await service.getCatalog();
    const pack = packDeCreditos(catalogo);

    // Cada uno calculado contra la MISMA base (100), nunca uno sobre el resultado del otro:
    // un Pro comprando en campaña recibe 100 + 20 + 20 = 140, no 100 + 20 + 24.
    expect(pack.proBonusAmount).toBe(20);
    expect(pack.campaignBonusAmount).toBe(20);
  });

  it('BARRERA 7 — los BUMPS tienen su propia campaña, y no se cruzan', async () => {
    // Una campaña de CRÉDITOS activa no puede regalar bumps: son types distintos.
    campaigns.getActiveCreditBonusCampaign.mockResolvedValue(campana('Solo créditos', 'PERCENT', 20));
    campaigns.getActiveBumpBonusCampaign.mockResolvedValue(null);

    let catalogo = await service.getCatalog();
    expect(packDeCreditos(catalogo).campaignBonusAmount).toBe(20);
    expect(packDeBumps(catalogo)).not.toHaveProperty('campaignBonusAmount');

    // Y al revés: con la de bumps viva, los bumps la reciben con su propia base (20 al 50 %).
    await build();
    campaigns.getActiveBumpBonusCampaign.mockResolvedValue({
      ...campana('Solo bumps', 'PERCENT', 50),
      type: CampaignType.BUMP_BONUS,
    });

    catalogo = await service.getCatalog();
    expect(packDeBumps(catalogo).campaignBonusAmount).toBe(10);
    expect(packDeCreditos(catalogo)).not.toHaveProperty('campaignBonusAmount');
    expect(catalogo.bumpBonusCampaign).toMatchObject({ name: 'Solo bumps' });
  });

  it('el catálogo pregunta por las DOS campañas de bonus, no sólo por los descuentos', async () => {
    // El defecto original en una línea: nadie llamaba a estos dos lectores fuera del
    // checkout. Si alguien los quitara de aquí, la campaña volvería a ser invisible y todo
    // lo demás seguiría compilando.
    await service.getCatalog();

    expect(campaigns.getActiveCreditBonusCampaign).toHaveBeenCalled();
    expect(campaigns.getActiveBumpBonusCampaign).toHaveBeenCalled();
  });
});
