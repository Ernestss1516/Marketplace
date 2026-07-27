import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { AppModule } from '../src/app.module';
import { InvoicingScheduleService } from '../src/modules/invoicing/invoicing-schedule.service';
import { InvoicingService } from '../src/modules/invoicing/invoicing.service';
import { INVOICING_PROVIDER, InvoicingProvider, EmitInvoiceInput, EmitInvoiceResult } from '../src/modules/invoicing/invoicing.types';
import { StubInvoicingProvider } from '../src/modules/invoicing/providers/stub-invoicing.provider';

// Fechas inyectadas (independientes del reloj real). Q3 = jul-sep 2026.
const TODAY_IN_Q4 = new Date(2026, 9, 5); // 5-oct → trimestre cerrado más reciente = Q3
const TODAY_IN_Q4_LATE = new Date(2026, 9, 20); // 20-oct (NO día 1) → recuperación
const TODAY_MID_Q4 = new Date(2026, 10, 15); // 15-nov
const TODAY_IN_SEP = new Date(2026, 8, 5); // 5-sep → mes cerrado = 2026-08
const TX_DATE_Q3 = new Date(2026, 7, 15); // 15-ago → cae en Q3 y en el mes 2026-08

const FISCAL = {
  fiscalTaxId: '12345678Z',
  fiscalName: 'Ada Lovelace',
  fiscalAddress: 'C/ Mayor 1',
  fiscalCity: 'Sevilla',
  fiscalPostalCode: '41001',
  fiscalProvince: 'Sevilla',
  fiscalCountry: 'ES',
};

const ISSUER = {
  taxId: 'B12345678',
  fiscalName: 'Marketplace S.L.',
  address: 'Av. Plataforma 2',
  city: 'Madrid',
  postalCode: '28001',
  province: 'Madrid',
  country: 'ES',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => Promise<boolean>, timeout = 20000, interval = 200): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await cond()) return;
    await sleep(interval);
  }
  throw new Error('waitFor: timeout');
}

async function seedFixtures(prisma: PrismaClient) {
  await cleanDb(prisma);
  // Reset de los Settings del cron (cleanDb no toca Setting) para aislar tests.
  await prisma.setting.deleteMany({
    where: { key: { in: ['fiscalInvoicingLastPeriod', 'fiscalInvoicingPeriodicity'] } },
  });
  await prisma.setting.upsert({
    where: { key: 'fiscalIssuer' },
    update: { value: ISSUER },
    create: { key: 'fiscalIssuer', value: ISSUER },
  });
}

async function createUser(prisma: PrismaClient, withFiscal: boolean) {
  const id = randomUUID().slice(0, 8);
  return prisma.user.create({
    data: {
      email: `cron-${id}@test.local`,
      name: `Cron ${id}`,
      slug: `cron-${id}`,
      ...(withFiscal ? FISCAL : {}),
    },
  });
}

async function createTx(prisma: PrismaClient, userId: string, createdAt: Date) {
  const product = await prisma.product.create({
    data: { name: `P${randomUUID().slice(0, 6)}`, type: 'ONE_TIME' },
  });
  const price = await prisma.price.create({ data: { productId: product.id, amount: '9.99' } });
  return prisma.transaction.create({
    data: {
      userId,
      priceId: price.id,
      amountGross: '9.99',
      amountNet: '8.26',
      taxAmount: '1.73',
      taxRate: '0.2100',
      status: 'SUCCEEDED',
      gateway: 'REDSYS',
      createdAt,
    },
  });
}

const unfacturedCount = (prisma: PrismaClient, userId: string) =>
  prisma.transaction.count({ where: { userId, invoiceLine: { is: null } } });

describe('Facturación automática (RF.13 R4) — cron y cola e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let schedule: InvoicingScheduleService;
  let invoicing: InvoicingService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    schedule = app.get(InvoicingScheduleService);
    invoicing = app.get(InvoicingService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await seedFixtures(prisma);
  });

  it('DÍA DE EMISIÓN + chain completo: encola y el worker emite la factura AUTO del trimestre', async () => {
    const user = await createUser(prisma, true);
    await createTx(prisma, user.id, TX_DATE_Q3);

    const summary = await schedule.runScheduledInvoicing(TODAY_IN_Q4);
    expect(summary.pending).toEqual(['2026-Q3']);
    expect(summary.dispatched[0].eligible).toEqual([user.id]);

    // el InvoiceProcessor emite de forma asíncrona → esperar
    await waitFor(async () => (await prisma.invoice.count({ where: { userId: user.id, status: 'ISSUED' } })) === 1);

    const inv = await prisma.invoice.findFirst({ where: { userId: user.id }, include: { lines: true } });
    expect(inv?.origin).toBe('AUTO_PERIODIC');
    expect(inv?.periodKey).toBe('2026-Q3');
    expect(inv?.idempotencyKey).toBe(`${user.id}:2026-Q3`);
    expect(inv?.lines).toHaveLength(1);
    expect(inv?.receiverTaxId).toBe('12345678Z');
    expect(await unfacturedCount(prisma, user.id)).toBe(0); // facturada
  });

  it('DÍA QUE NO TOCA: marca al día → no despacha nada', async () => {
    await prisma.setting.upsert({
      where: { key: 'fiscalInvoicingLastPeriod' },
      update: { value: '2026-Q3' },
      create: { key: 'fiscalInvoicingLastPeriod', value: '2026-Q3' },
    });
    const user = await createUser(prisma, true);
    await createTx(prisma, user.id, TX_DATE_Q3);

    const summary = await schedule.runScheduledInvoicing(TODAY_MID_Q4);
    expect(summary.pending).toEqual([]);
    expect(summary.dispatched).toEqual([]);

    await sleep(500);
    expect(await prisma.invoice.count()).toBe(0);
  });

  it('RECUPERACIÓN: marca un trimestre por detrás e invocado un día distinto del 1 → emite el pendiente', async () => {
    await prisma.setting.upsert({
      where: { key: 'fiscalInvoicingLastPeriod' },
      update: { value: '2026-Q2' },
      create: { key: 'fiscalInvoicingLastPeriod', value: '2026-Q2' },
    });
    const user = await createUser(prisma, true);
    await createTx(prisma, user.id, TX_DATE_Q3);

    const summary = await schedule.runScheduledInvoicing(TODAY_IN_Q4_LATE); // 20-oct, no día 1
    expect(summary.pending).toEqual(['2026-Q3']);

    await waitFor(async () => (await prisma.invoice.count({ where: { userId: user.id } })) === 1);
  });

  it('IDEMPOTENCIA (doble disparo del cron): la 2ª vez no crea facturas duplicadas', async () => {
    const user = await createUser(prisma, true);
    await createTx(prisma, user.id, TX_DATE_Q3);

    await schedule.runScheduledInvoicing(TODAY_IN_Q4);
    await waitFor(async () => (await prisma.invoice.count({ where: { userId: user.id } })) === 1);

    const second = await schedule.runScheduledInvoicing(TODAY_IN_Q4); // marca ya en Q3 → no-op
    expect(second.pending).toEqual([]);
    await sleep(500);
    expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(1);
  });

  it('IDEMPOTENCIA (nivel emisión): emitForPeriod dos veces devuelve la misma, sin duplicar', async () => {
    const user = await createUser(prisma, true);
    await createTx(prisma, user.id, TX_DATE_Q3);

    const a = await invoicing.emitForPeriod(user.id, '2026-Q3');
    const b = await invoicing.emitForPeriod(user.id, '2026-Q3');
    expect(a?.id).toBe(b?.id);
    expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(1);
  });

  it('SIN DATOS FISCALES: no se emite, se notifica, y las Transactions siguen facturables', async () => {
    const user = await createUser(prisma, false);
    await createTx(prisma, user.id, TX_DATE_Q3);

    const summary = await schedule.runScheduledInvoicing(TODAY_IN_Q4);
    expect(summary.dispatched[0].eligible).toEqual([]);
    expect(summary.dispatched[0].missingFiscalData).toEqual([user.id]);

    await sleep(500);
    expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(0);

    const notif = await prisma.notification.findFirst({
      where: { userId: user.id, type: 'INVOICING_PENDING_FISCAL_DATA' },
    });
    expect(notif).not.toBeNull();
    expect(await unfacturedCount(prisma, user.id)).toBe(1);
  });

  it('CONFIGURABLE: Setting fiscalInvoicingPeriodicity=MONTHLY → factura por meses', async () => {
    await prisma.setting.upsert({
      where: { key: 'fiscalInvoicingPeriodicity' },
      update: { value: 'MONTHLY' },
      create: { key: 'fiscalInvoicingPeriodicity', value: 'MONTHLY' },
    });
    const user = await createUser(prisma, true);
    await createTx(prisma, user.id, TX_DATE_Q3); // 15-ago → mes 2026-08

    const summary = await schedule.runScheduledInvoicing(TODAY_IN_SEP); // 5-sep → mes cerrado 2026-08
    expect(summary.periodicity).toBe('MONTHLY');
    expect(summary.pending).toEqual(['2026-08']);

    await waitFor(async () => (await prisma.invoice.count({ where: { userId: user.id } })) === 1);
    const inv = await prisma.invoice.findFirst({ where: { userId: user.id } });
    expect(inv?.periodKey).toBe('2026-08');
  });
});

/**
 * Suite separada (app propia con proveedor sobrescrito) — ejerce el rollback: un
 * fallo del proveedor a mitad limpia el DRAFT (libera las Transactions) y el
 * reintento emite bien, sin factura duplicada ni Transaction bloqueada.
 */
class FlakyProvider implements InvoicingProvider {
  private readonly stub = new StubInvoicingProvider();
  failNext = false;
  async emitInvoice(input: EmitInvoiceInput): Promise<EmitInvoiceResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('proveedor caído (test)');
    }
    return this.stub.emitInvoice(input);
  }
}

describe('Facturación automática — rollback en fallo del proveedor', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let invoicing: InvoicingService;
  const flaky = new FlakyProvider();

  beforeAll(async () => {
    prisma = new PrismaClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(INVOICING_PROVIDER)
      .useValue(flaky)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    invoicing = app.get(InvoicingService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await seedFixtures(prisma);
  });

  it('provider lanza → DRAFT limpiado (0 facturas, tx liberada); reintento emite sin duplicar', async () => {
    const user = await createUser(prisma, true);
    await createTx(prisma, user.id, TX_DATE_Q3);

    flaky.failNext = true;
    await expect(invoicing.emitForPeriod(user.id, '2026-Q3')).rejects.toThrow();

    // rollback: sin factura, la Transaction vuelve a estar facturable
    expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(0);
    expect(await unfacturedCount(prisma, user.id)).toBe(1);

    // reintento (flaky ya no falla) → emite bien, exactamente una factura
    const inv = await invoicing.emitForPeriod(user.id, '2026-Q3');
    expect(inv).not.toBeNull();
    expect(await prisma.invoice.count({ where: { userId: user.id, status: 'ISSUED' } })).toBe(1);
  });
});
