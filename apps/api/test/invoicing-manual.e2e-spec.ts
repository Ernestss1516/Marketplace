import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

/**
 * RF.13 R3 — EMISIÓN MANUAL de facturas, flujo completo de punta a punta (con el
 * StubInvoicingProvider y R2/MinIO reales). Primera demostración de la cadena
 * entera: elegibilidad → congelación → stub → PDF en R2 → latch ISSUED → descarga.
 * Ejercido por HTTP (guards, ownership, streaming), no solo por la capa de servicio.
 */
describe('Facturación — emisión manual (RF.13 R3) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const hash = (pw: string) => bcrypt.hash(pw, 4);
  const PASSWORD = 'Test1234!';

  const FISCAL = {
    fiscalTaxId: '12345678Z',
    fiscalName: 'Ada Lovelace',
    fiscalAddress: 'C/ Mayor 1',
    fiscalCity: 'Sevilla',
    fiscalPostalCode: '41001',
    fiscalProvince: 'Sevilla',
    fiscalCountry: 'ES',
  };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    // Emisor fiscal (Setting no lo toca cleanDb). Idempotente.
    await prisma.setting.upsert({
      where: { key: 'fiscalIssuer' },
      update: {
        value: {
          taxId: 'B12345678',
          fiscalName: 'Marketplace S.L.',
          address: 'Av. de la Plataforma 2',
          city: 'Madrid',
          postalCode: '28001',
          province: 'Madrid',
          country: 'ES',
        },
      },
      create: {
        key: 'fiscalIssuer',
        value: {
          taxId: 'B12345678',
          fiscalName: 'Marketplace S.L.',
          address: 'Av. de la Plataforma 2',
          city: 'Madrid',
          postalCode: '28001',
          province: 'Madrid',
          country: 'ES',
        },
      },
    });
  });

  async function createUser(withFiscal: boolean) {
    const id = randomUUID().slice(0, 8);
    return prisma.user.create({
      data: {
        email: `fact-${id}@test.local`,
        name: `Fact ${id}`,
        slug: `fact-${id}`,
        passwordHash: await hash(PASSWORD),
        emailVerified: true,
        ...(withFiscal ? FISCAL : {}),
      },
    });
  }

  async function login(email: string): Promise<string> {
    const res = await request(server).post('/api/auth/login').send({ email, password: PASSWORD });
    return res.body.accessToken as string;
  }

  async function createFacturableTx(
    userId: string,
    data: { status?: 'SUCCEEDED' | 'FAILED'; concept?: 'credits' } = {},
  ) {
    const product = await prisma.product.create({
      data: { name: `Prod ${randomUUID().slice(0, 6)}`, type: 'ONE_TIME' },
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
        status: data.status ?? 'SUCCEEDED',
        gateway: 'REDSYS',
        ...(data.concept === 'credits' ? { baseCreditAmount: 50 } : {}),
      },
    });
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('flujo completo: usuario elegible → facturables → factura ISSUED con N líneas → facturados', async () => {
    const user = await createUser(true);
    await createFacturableTx(user.id, { concept: 'credits' });
    await createFacturableTx(user.id);
    await createFacturableTx(user.id, { status: 'FAILED' }); // NO facturable
    const token = await login(user.email);

    // facturables: 2 (el FAILED excluido)
    const fact = await request(server).get('/api/billing/facturables').set(auth(token)).expect(200);
    expect(fact.body).toHaveLength(2);
    expect(fact.body[0].concept).toEqual(expect.any(String));

    // eligibility
    const elig = await request(server).get('/api/billing/eligibility').set(auth(token)).expect(200);
    expect(elig.body).toMatchObject({ canRequest: true, hasFiscalData: true, facturableCount: 2 });

    // emitir
    const emit = await request(server).post('/api/billing/facturas').set(auth(token)).expect(201);
    expect(emit.body.status).toBe('ISSUED');
    expect(emit.body.number).toMatch(/^DEV-\d{4}-\d{6}$/);
    expect(emit.body.lineCount).toBe(2);
    expect(emit.body.totalGross).toBe('19.98'); // 9.99 × 2
    expect(emit.body.hasPdf).toBe(true);

    // en BD: ISSUED, 2 líneas, pdfKey, datos congelados
    const inv = await prisma.invoice.findUnique({ where: { id: emit.body.id }, include: { lines: true } });
    expect(inv?.status).toBe('ISSUED');
    expect(inv?.lines).toHaveLength(2);
    expect(inv?.pdfKey).toBe(`facturas/${inv?.id}.pdf`);
    expect(inv?.receiverTaxId).toBe('12345678Z');
    expect(inv?.issuerTaxId).toBe('B12345678');

    // ya no quedan facturables
    const after = await request(server).get('/api/billing/facturables').set(auth(token)).expect(200);
    expect(after.body).toHaveLength(0);

    // my-invoices lista la factura
    const mine = await request(server).get('/api/billing/my-invoices').set(auth(token)).expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].id).toBe(emit.body.id);
  });

  it('idempotencia: pedir factura otra vez → NO crea una segunda (409, sin doble facturación)', async () => {
    const user = await createUser(true);
    await createFacturableTx(user.id);
    const token = await login(user.email);

    await request(server).post('/api/billing/facturas').set(auth(token)).expect(201);
    await request(server).post('/api/billing/facturas').set(auth(token)).expect(409); // nada facturable ya

    const count = await prisma.invoice.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });

  it('sin datos fiscales → eligibility false (MISSING_FISCAL_DATA) y POST 400, no crea nada', async () => {
    const user = await createUser(false);
    await createFacturableTx(user.id);
    const token = await login(user.email);

    const elig = await request(server).get('/api/billing/eligibility').set(auth(token)).expect(200);
    expect(elig.body).toMatchObject({ canRequest: false, reason: 'MISSING_FISCAL_DATA', hasFiscalData: false });

    await request(server).post('/api/billing/facturas').set(auth(token)).expect(400);
    expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(0);
  });

  it('sin movimientos facturables → eligibility false (NO_INVOICEABLE_MOVEMENTS) y POST 409', async () => {
    const user = await createUser(true);
    const token = await login(user.email);

    const elig = await request(server).get('/api/billing/eligibility').set(auth(token)).expect(200);
    expect(elig.body).toMatchObject({ canRequest: false, reason: 'NO_INVOICEABLE_MOVEMENTS' });

    await request(server).post('/api/billing/facturas').set(auth(token)).expect(409);
  });

  it('descarga: el DUEÑO obtiene el PDF (200, application/pdf); OTRO usuario → 403', async () => {
    const owner = await createUser(true);
    await createFacturableTx(owner.id);
    const ownerToken = await login(owner.email);
    const emit = await request(server).post('/api/billing/facturas').set(auth(ownerToken)).expect(201);

    const dl = await request(server)
      .get(`/api/billing/invoices/${emit.body.id}/pdf`)
      .set(auth(ownerToken))
      .expect(200);
    expect(dl.headers['content-type']).toContain('application/pdf');
    expect(dl.headers['content-disposition']).toContain('attachment');

    const other = await createUser(true);
    const otherToken = await login(other.email);
    await request(server)
      .get(`/api/billing/invoices/${emit.body.id}/pdf`)
      .set(auth(otherToken))
      .expect(403);
  });

  it('datos congelados: cambiar el NIF DESPUÉS de emitir no altera la factura', async () => {
    const user = await createUser(true);
    await createFacturableTx(user.id);
    const token = await login(user.email);
    const emit = await request(server).post('/api/billing/facturas').set(auth(token)).expect(201);

    // el usuario cambia su NIF más tarde
    await prisma.user.update({ where: { id: user.id }, data: { fiscalTaxId: 'X1234567L' } });

    const inv = await prisma.invoice.findUnique({ where: { id: emit.body.id } });
    expect(inv?.receiverTaxId).toBe('12345678Z'); // el viejo, congelado
  });
});
