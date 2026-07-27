import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { InvoicingService } from '../src/modules/invoicing/invoicing.service';

/**
 * RF.13 R5 — panel admin de facturas: listado/filtros/descarga de TODAS las
 * facturas + configuración del emisor fiscal (validado, auditado, NO retroactivo).
 */
describe('Admin — panel de facturas (RF.13 R5) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let invoicing: InvoicingService;

  const hash = (pw: string) => bcrypt.hash(pw, 4);
  const PASSWORD = 'Test1234!';
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const FISCAL = {
    fiscalTaxId: '12345678Z',
    fiscalName: 'Ada Lovelace',
    fiscalAddress: 'C/ Mayor 1',
    fiscalCity: 'Sevilla',
    fiscalPostalCode: '41001',
    fiscalProvince: 'Sevilla',
    fiscalCountry: 'ES',
  };
  // CIF válidos (pasan el validador). A: emisor inicial; B: nuevo emisor.
  const ISSUER_A = { taxId: 'A58818501', fiscalName: 'Emisor A S.L.', address: 'Av. A 1', city: 'Madrid', postalCode: '28001', province: 'Madrid', country: 'ES' };
  const ISSUER_B_TAXID = 'B12345674';

  let adminToken: string;
  let userToken: string;
  let modToken: string;
  let user1Id: string;
  let inv1Id: string; // user1, Q3, emitida con emisor A
  let inv2Id: string; // user2, Q3

  async function login(email: string, admin = false): Promise<string> {
    // Un usuario ADMIN NO puede usar /auth/login (auth.service lo rechaza con 403):
    // debe autenticarse por /auth/admin-login. Usuarios normales van por /auth/login.
    const path = admin ? '/api/auth/admin-login' : '/api/auth/login';
    const res = await request(server).post(path).send({ email, password: PASSWORD });
    return res.body.accessToken as string;
  }

  async function createUser(role: 'ADMIN' | 'MODERATOR' | 'USER', withFiscal: boolean) {
    const id = randomUUID().slice(0, 8);
    return prisma.user.create({
      data: {
        email: `adm-${id}@test.local`,
        name: `U ${id}`,
        slug: `adm-${id}`,
        passwordHash: await hash(PASSWORD),
        emailVerified: true,
        role,
        ...(withFiscal ? FISCAL : {}),
      },
    });
  }

  async function createTx(userId: string, createdAt: Date) {
    const product = await prisma.product.create({ data: { name: `P${randomUUID().slice(0, 6)}`, type: 'ONE_TIME' } });
    const price = await prisma.price.create({ data: { productId: product.id, amount: '9.99' } });
    return prisma.transaction.create({
      data: { userId, priceId: price.id, amountGross: '9.99', amountNet: '8.26', taxAmount: '1.73', taxRate: '0.2100', status: 'SUCCEEDED', gateway: 'REDSYS', createdAt },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    server = app.getHttpServer();
    invoicing = app.get(InvoicingService);

    await cleanDb(prisma);
    await prisma.setting.deleteMany({ where: { key: { in: ['fiscalIssuer'] } } });
    await prisma.setting.create({ data: { key: 'fiscalIssuer', value: ISSUER_A } });

    const admin = await createUser('ADMIN', false);
    const mod = await createUser('MODERATOR', false);
    const user1 = await createUser('USER', true);
    const user2 = await createUser('USER', true);
    user1Id = user1.id;

    adminToken = await login(admin.email, true);
    modToken = await login(mod.email);
    userToken = await login(user1.email);

    // Movimientos + emisión (con emisor A) para dos usuarios distintos.
    await createTx(user1.id, new Date(2026, 7, 15)); // Q3
    await createTx(user1.id, new Date(2026, 4, 15)); // Q2 (sin facturar aún — para el test de no-retroactividad)
    await createTx(user2.id, new Date(2026, 7, 15)); // Q3

    const inv1 = await invoicing.emitForPeriod(user1.id, '2026-Q3');
    const inv2 = await invoicing.emitForPeriod(user2.id, '2026-Q3');
    inv1Id = inv1!.id;
    inv2Id = inv2!.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lista facturas de VARIOS usuarios (no solo las de uno)', async () => {
    const res = await request(server).get('/api/admin/invoices').set(auth(adminToken)).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    const userIds = new Set(res.body.items.map((i: { user: { id: string } }) => i.user.id));
    expect(userIds.size).toBeGreaterThanOrEqual(2);
  });

  it('filtra por origin=AUTO_PERIODIC y por periodKey', async () => {
    const res = await request(server)
      .get('/api/admin/invoices?origin=AUTO_PERIODIC&periodKey=2026-Q3')
      .set(auth(adminToken))
      .expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    expect(res.body.items.every((i: { origin: string; periodKey: string }) => i.origin === 'AUTO_PERIODIC' && i.periodKey === '2026-Q3')).toBe(true);
  });

  it('permisos: ADMIN → 200, USER → 403, MODERATOR → 403, sin auth → 401', async () => {
    // ADMIN autentica Y autoriza (contraste real: si el adminToken estuviera roto
    // daría 401, no 200, y los 403 de abajo no probarían "rol insuficiente").
    await request(server).get('/api/admin/invoices').set(auth(adminToken)).expect(200);
    await request(server).get('/api/admin/invoices').set(auth(userToken)).expect(403);
    await request(server).get('/api/admin/invoices').set(auth(modToken)).expect(403);
    await request(server).get('/api/admin/invoices').expect(401);
  });

  it('descarga admin: ADMIN descarga el PDF de la factura de OTRO usuario → 200', async () => {
    const res = await request(server).get(`/api/admin/invoices/${inv2Id}/pdf`).set(auth(adminToken)).expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    // Contraste con R3: un usuario normal NO puede descargar la de otro (owner-scope)
    await request(server).get(`/api/billing/invoices/${inv2Id}/pdf`).set(auth(userToken)).expect(403);
  });

  it('PUT emisor con NIF inválido → 400 (no guarda)', async () => {
    await request(server)
      .put('/api/admin/fiscal-issuer')
      .set(auth(adminToken))
      .send({ ...ISSUER_A, taxId: 'B12345678' }) // control incorrecto
      .expect(400);
  });

  it('PUT emisor con un campo obligatorio ausente → 400', async () => {
    const { address, ...missingAddress } = { ...ISSUER_A, taxId: ISSUER_B_TAXID };
    void address;
    await request(server).put('/api/admin/fiscal-issuer').set(auth(adminToken)).send(missingAddress).expect(400);
  });

  it('PUT emisor válido → 200, Setting actualizado y AuditLog registrado', async () => {
    const nuevo = { ...ISSUER_A, taxId: ISSUER_B_TAXID, fiscalName: 'Emisor B S.L.' };
    await request(server).put('/api/admin/fiscal-issuer').set(auth(adminToken)).send(nuevo).expect(200);

    const setting = await prisma.setting.findUnique({ where: { key: 'fiscalIssuer' } });
    expect((setting?.value as { taxId: string }).taxId).toBe(ISSUER_B_TAXID);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'FISCAL_ISSUER_UPDATE' }, orderBy: { createdAt: 'desc' } });
    expect(audit).not.toBeNull();
    expect((audit?.after as { taxId: string }).taxId).toBe(ISSUER_B_TAXID);
  });

  it('NO-RETROACTIVIDAD: cambiar el emisor no altera facturas ya emitidas; solo las futuras', async () => {
    // La factura Q3 de user1 se emitió con emisor A en beforeAll.
    const inv1 = await prisma.invoice.findUnique({ where: { id: inv1Id } });
    expect(inv1?.issuerTaxId).toBe('A58818501');

    // Cambiar el emisor a B vía admin.
    const nuevo = { ...ISSUER_A, taxId: ISSUER_B_TAXID, fiscalName: 'Emisor B S.L.' };
    await request(server).put('/api/admin/fiscal-issuer').set(auth(adminToken)).send(nuevo).expect(200);

    // Emitir una NUEVA factura (user1, Q2) → usa el emisor B.
    const inv2 = await invoicing.emitForPeriod(user1Id, '2026-Q2');
    const fresh = await prisma.invoice.findUnique({ where: { id: inv2!.id } });
    expect(fresh?.issuerTaxId).toBe(ISSUER_B_TAXID);

    // La antigua SIGUE con el emisor A (inmutable).
    const inv1Again = await prisma.invoice.findUnique({ where: { id: inv1Id } });
    expect(inv1Again?.issuerTaxId).toBe('A58818501');
  });
});
