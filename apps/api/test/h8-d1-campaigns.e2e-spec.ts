/**
 * H8 Bloque D fase 1 — Motor de campañas + bonus de créditos promocional (e2e)
 *
 * Covers:
 *   - Admin CRUD (/admin/campaigns): auth (401/403 ADMIN-only), create, edit,
 *     activar/desactivar, listado con status derivado (upcoming|live|ended)
 *   - Validación de solapamiento: bloquea ACTIVE que solapa con otra ACTIVE del
 *     mismo type; permite crear INACTIVE solapada; bloquea activar una inactiva
 *     que solapa; editar sin activar/mover fechas no re-valida
 *   - Validación de params (CREDIT_BONUS → {kind, value})
 *   - AuditLog: CAMPAIGN_CREATE, CAMPAIGN_EDIT, CAMPAIGN_ACTIVATE, CAMPAIGN_DEACTIVATE
 *   - Checkout (RedsysService.createCreditPackCheckout): congela campaignBonusAmount
 *     + campaignId según la campaña CREDIT_BONUS activa (PERCENT y FIXED); se SUMA
 *     al bonus Pro
 *   - Processor (RedsysProcessor.processSuccess): acredita lo congelado sin
 *     recalcular — incluso si la campaña se desactiva entre checkout y processor
 *
 * Nota: Campaign no tiene FK a User, así que cleanDb() (TRUNCATE "User" CASCADE)
 * no lo limpia. Se limpia explícitamente en este archivo.
 */

import { INestApplication } from '@nestjs/common';
import {
  CampaignType,
  CreditLedgerType,
  EntitlementType,
  PrismaClient,
  TransactionStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { RedsysProcessor } from 'src/modules/redsys/redsys.processor';
import { RedsysService } from 'src/modules/redsys/redsys.service';
import { redsysTaxBreakdown } from 'src/modules/redsys/redsys.types';

describe('H8 Bloque D fase 1 — Campaigns (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let processor: RedsysProcessor;
  let redsysService: RedsysService;

  let adminToken: string;
  let userToken: string;
  let moderatorToken: string;
  let regularUserId: string;
  let proUserId: string;

  let packBasicoId: string;
  let packBasicoPriceId: string;
  let packBasicoCreditAmount: number; // 50
  let packBasicoAmountEur: string; // "4.99"

  const hash = (pw: string) => bcrypt.hash(pw, 4);

  /** Removes every Campaign this suite may have created. Not covered by cleanDb(). */
  async function cleanCampaigns(): Promise<void> {
    await prisma.transaction.updateMany({ data: { campaignId: null } });
    await prisma.campaign.deleteMany({});
  }

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    await cleanCampaigns();

    processor = app.get(RedsysProcessor);
    redsysService = app.get(RedsysService);

    const [admin, regularUser, moderator, proUser] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'h8d1-admin@example.com',
          name: 'H8D1 Admin',
          slug: 'h8d1-admin',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          email: 'h8d1-user@example.com',
          name: 'H8D1 Regular User',
          slug: 'h8d1-user',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      }),
      prisma.user.create({
        data: {
          email: 'h8d1-mod@example.com',
          name: 'H8D1 Moderator',
          slug: 'h8d1-mod',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'MODERATOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'h8d1-pro@example.com',
          name: 'H8D1 Pro User',
          slug: 'h8d1-pro',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      }),
    ]);

    regularUserId = regularUser.id;
    proUserId = proUser.id;
    void admin;

    await prisma.entitlement.create({
      data: {
        userId: proUserId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const pack = await prisma.creditPack.findFirst({
      where: { name: 'Pack Básico' },
      include: { price: true },
    });
    if (!pack?.price) throw new Error('Pack Básico not found in test seed — run seed-test.ts');
    packBasicoId = pack.id;
    packBasicoPriceId = pack.price.id;
    packBasicoCreditAmount = pack.creditAmount; // 50
    packBasicoAmountEur = pack.price.amount.toString(); // "4.99"

    const [adminRes, userRes, modRes] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: 'h8d1-admin@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'h8d1-user@example.com', password: 'Test1234!' }),
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'h8d1-mod@example.com', password: 'Test1234!' }),
    ]);

    adminToken = adminRes.body.accessToken as string;
    userToken = userRes.body.accessToken as string;
    moderatorToken = modRes.body.accessToken as string;
  });

  afterAll(async () => {
    await cleanCampaigns();
    await app.close();
    await prisma.$disconnect();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  function farFutureWindow(offsetDays: number, durationDays = 5) {
    const base = Date.now() + 365 * 24 * 60 * 60 * 1000; // +1 year, well clear of "now"
    const startsAt = new Date(base + offsetDays * 24 * 60 * 60 * 1000).toISOString();
    const endsAt = new Date(
      base + (offsetDays + durationDays) * 24 * 60 * 60 * 1000,
    ).toISOString();
    return { startsAt, endsAt };
  }

  function nowWindow(durationMs = 60 * 60 * 1000) {
    return {
      startsAt: new Date(Date.now() - durationMs).toISOString(),
      endsAt: new Date(Date.now() + durationMs).toISOString(),
    };
  }

  function correctCents(amountEur: string): string {
    return redsysTaxBreakdown(amountEur).amountGross.mul(100).toFixed(0);
  }

  async function createPendingTransaction(
    dsOrder: string,
    overrides?: {
      userId?: string;
      bonusCreditAmount?: number | null;
      campaignBonusAmount?: number | null;
      campaignId?: string | null;
    },
  ) {
    const tax = redsysTaxBreakdown(packBasicoAmountEur);
    return prisma.transaction.create({
      data: {
        userId: overrides?.userId ?? regularUserId,
        priceId: packBasicoPriceId,
        ...tax,
        status: TransactionStatus.PENDING,
        gateway: 'REDSYS',
        gatewayPaymentIntentId: dsOrder,
        bonusCreditAmount: overrides?.bonusCreditAmount ?? null,
        campaignBonusAmount: overrides?.campaignBonusAmount ?? null,
        campaignId: overrides?.campaignId ?? null,
      },
      select: { id: true, amountGross: true, gatewayPaymentIntentId: true },
    });
  }

  // ── Admin CRUD: auth ────────────────────────────────────────────────────────

  describe('Admin auth', () => {
    it('GET /api/admin/campaigns sin auth → 401', async () => {
      await request(app.getHttpServer()).get('/api/admin/campaigns').expect(401);
    });

    it('GET /api/admin/campaigns como USER → 403', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/campaigns')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    // ROLES R2 — estos dos decían «ADMIN-only, no moderation». Las campañas bajan
    // a MODERATOR con el resto del catálogo comercial (cupones, patrocinados).
    // Sigue habiendo frontera: USER y sin-token, arriba en este mismo bloque.
    it('GET /api/admin/campaigns como MODERATOR → 200', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/campaigns')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .expect(200);
    });

    it('POST /api/admin/campaigns como MODERATOR → 201', async () => {
      const { startsAt, endsAt } = farFutureWindow(0);
      const res = await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({
          name: 'H8D1 Test Auth',
          type: 'CREDIT_BONUS',
          startsAt,
          endsAt,
          params: { kind: 'PERCENT', value: 10 },
        })
        .expect(201);

      // IMPRESCINDIBLE limpiarla: usa la MISMA ventana `farFutureWindow(0)` que
      // el caso «crea una campaña CREDIT_BONUS válida» de abajo, y dos campañas
      // solapadas del mismo tipo se rechazan. Mientras este POST daba 403 no
      // dejaba estado; ahora sí.
      await prisma.campaign.delete({ where: { id: res.body.id as string } });
    });
  });

  // ── Admin CRUD: create + validation ────────────────────────────────────────

  describe('Admin — create', () => {
    afterEach(cleanCampaigns);

    it('crea una campaña CREDIT_BONUS válida (PERCENT)', async () => {
      const { startsAt, endsAt } = farFutureWindow(0);
      const res = await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D1 Test Verano',
          type: 'CREDIT_BONUS',
          startsAt,
          endsAt,
          params: { kind: 'PERCENT', value: 20 },
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.active).toBe(true);
      expect(res.body.params).toEqual({ kind: 'PERCENT', value: 20 });

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'CAMPAIGN_CREATE', resourceId: res.body.id },
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry!.resourceType).toBe('Campaign');
    });

    it('endsAt <= startsAt → 400', async () => {
      const { startsAt, endsAt } = farFutureWindow(0);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D1 Test Fechas Invalidas',
          type: 'CREDIT_BONUS',
          startsAt: endsAt,
          endsAt: startsAt,
          params: { kind: 'FIXED', value: 50 },
        })
        .expect(400);
    });

    it('params inválidos (sin kind/value) → 400', async () => {
      const { startsAt, endsAt } = farFutureWindow(0);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'H8D1 Test Params Malos', type: 'CREDIT_BONUS', startsAt, endsAt, params: {} })
        .expect(400);
    });

    it('params.kind fuera de PERCENT|FIXED → 400', async () => {
      const { startsAt, endsAt } = farFutureWindow(0);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D1 Test Kind Malo',
          type: 'CREDIT_BONUS',
          startsAt,
          endsAt,
          params: { kind: 'BOGUS', value: 10 },
        })
        .expect(400);
    });

    it('crear ACTIVE solapada con otra ACTIVE del mismo type → 400 CAMPAIGN_OVERLAP', async () => {
      const window = farFutureWindow(100, 10);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D1 Test Overlap Base',
          type: 'CREDIT_BONUS',
          ...window,
          params: { kind: 'FIXED', value: 30 },
        })
        .expect(201);

      // Overlapping window (starts 5 days into the first one's range).
      const overlapping = {
        startsAt: new Date(new Date(window.startsAt).getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        endsAt: new Date(new Date(window.endsAt).getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const res = await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D1 Test Overlap Segunda',
          type: 'CREDIT_BONUS',
          ...overlapping,
          params: { kind: 'FIXED', value: 30 },
        })
        .expect(400);

      expect(res.body.message?.code ?? res.body.code).toBe('CAMPAIGN_OVERLAP');
    });

    it('crear INACTIVE solapada con otra ACTIVE del mismo type → permitido (201)', async () => {
      const window = farFutureWindow(200, 10);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D1 Test Inactive Base',
          type: 'CREDIT_BONUS',
          ...window,
          params: { kind: 'FIXED', value: 30 },
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D1 Test Inactive Solapada',
          type: 'CREDIT_BONUS',
          ...window,
          active: false,
          params: { kind: 'FIXED', value: 30 },
        })
        .expect(201);
    });
  });

  // ── Admin CRUD: update ──────────────────────────────────────────────────────

  describe('Admin — update', () => {
    afterEach(cleanCampaigns);

    it('activar una INACTIVE que solapa con otra ACTIVE del mismo type → 400 CAMPAIGN_OVERLAP', async () => {
      const window = farFutureWindow(300, 10);

      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D1 Test Activate Base',
          type: 'CREDIT_BONUS',
          ...window,
          params: { kind: 'FIXED', value: 30 },
        })
        .expect(201);

      const inactiveRes = await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D1 Test Activate Inactive',
          type: 'CREDIT_BONUS',
          ...window,
          active: false,
          params: { kind: 'FIXED', value: 30 },
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/campaigns/${inactiveRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: true })
        .expect(400);

      expect(res.body.message?.code ?? res.body.code).toBe('CAMPAIGN_OVERLAP');
    });

    it('editar name/params sin tocar active/fechas no re-valida solapamiento (200)', async () => {
      const window = farFutureWindow(400, 10);
      const created = await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D1 Test Edit Simple',
          type: 'CREDIT_BONUS',
          ...window,
          params: { kind: 'FIXED', value: 30 },
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/campaigns/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'H8D1 Test Edit Simple (renombrada)' })
        .expect(200);

      expect(res.body.name).toBe('H8D1 Test Edit Simple (renombrada)');

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'CAMPAIGN_EDIT', resourceId: created.body.id },
      });
      expect(auditEntry).not.toBeNull();
    });

    it('desactivar una ACTIVE registra CAMPAIGN_DEACTIVATE', async () => {
      const window = farFutureWindow(500, 10);
      const created = await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D1 Test Deactivate',
          type: 'CREDIT_BONUS',
          ...window,
          params: { kind: 'FIXED', value: 30 },
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/admin/campaigns/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false })
        .expect(200);

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'CAMPAIGN_DEACTIVATE', resourceId: created.body.id },
      });
      expect(auditEntry).not.toBeNull();
    });

    it('activar una INACTIVE sin solapamiento registra CAMPAIGN_ACTIVATE', async () => {
      const window = farFutureWindow(600, 10);
      const created = await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D1 Test Activate OK',
          type: 'CREDIT_BONUS',
          ...window,
          active: false,
          params: { kind: 'FIXED', value: 30 },
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/campaigns/${created.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: true })
        .expect(200);

      expect(res.body.active).toBe(true);

      const auditEntry = await prisma.auditLog.findFirst({
        where: { action: 'CAMPAIGN_ACTIVATE', resourceId: created.body.id },
      });
      expect(auditEntry).not.toBeNull();
    });

    it('PATCH a campaña inexistente → 404', async () => {
      await request(app.getHttpServer())
        .patch('/api/admin/campaigns/xxxxxxxx-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'no existe' })
        .expect(404);
    });
  });

  // ── Admin CRUD: list + status derivado ─────────────────────────────────────

  describe('Admin — list', () => {
    afterEach(cleanCampaigns);

    it('deriva status upcoming|live|ended sin persistirlo', async () => {
      const upcoming = farFutureWindow(700, 5);
      const live = nowWindow();
      const ended = {
        startsAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        endsAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      };

      await Promise.all([
        request(app.getHttpServer())
          .post('/api/admin/campaigns')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: 'H8D1 Test List Upcoming',
            type: 'CREDIT_BONUS',
            ...upcoming,
            active: false,
            params: { kind: 'FIXED', value: 5 },
          }),
        request(app.getHttpServer())
          .post('/api/admin/campaigns')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            name: 'H8D1 Test List Ended',
            type: 'CREDIT_BONUS',
            ...ended,
            active: false,
            params: { kind: 'FIXED', value: 5 },
          }),
      ]);

      // Live campaign created separately (must be the only ACTIVE one, else overlap 400).
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D1 Test List Live',
          type: 'CREDIT_BONUS',
          ...live,
          params: { kind: 'FIXED', value: 5 },
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/admin/campaigns?perPage=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const byName = Object.fromEntries(
        (res.body.items as { name: string; status: string }[]).map((c) => [c.name, c.status]),
      );
      expect(byName['H8D1 Test List Upcoming']).toBe('upcoming');
      expect(byName['H8D1 Test List Ended']).toBe('ended');
      expect(byName['H8D1 Test List Live']).toBe('live');
    });

    it('filtra por type y active', async () => {
      const window = farFutureWindow(800, 5);
      await request(app.getHttpServer())
        .post('/api/admin/campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'H8D1 Test Filter',
          type: 'CREDIT_BONUS',
          ...window,
          active: false,
          params: { kind: 'FIXED', value: 5 },
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/admin/campaigns?type=CREDIT_BONUS&active=false')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      expect(
        (res.body.items as { type: string; active: boolean }[]).every(
          (c) => c.type === 'CREDIT_BONUS' && c.active === false,
        ),
      ).toBe(true);
    });
  });

  // ── Checkout: congelado del bonus de campaña ───────────────────────────────

  describe('Checkout — campaign bonus freeze', () => {
    const MOCK_FORM = {
      Ds_MerchantParameters: 'mock',
      Ds_SignatureVersion: 'HMAC_SHA256_V1',
      Ds_Signature: 'mock',
      tpvUrl: 'https://mock.tpv/',
    };

    beforeEach(async () => {
      jest.spyOn(redsysService as any, 'buildForm').mockReturnValue(MOCK_FORM);
      await cleanCampaigns();
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      await prisma.transaction.deleteMany({ where: { userId: { in: [regularUserId, proUserId] } } });
      await cleanCampaigns();
    });

    it('sin campaña activa → campaignBonusAmount y campaignId null', async () => {
      await redsysService.createCreditPackCheckout(regularUserId, { packId: packBasicoId });

      const tx = await prisma.transaction.findFirst({
        where: { userId: regularUserId, status: TransactionStatus.PENDING },
        orderBy: { createdAt: 'desc' },
      });
      expect(tx?.campaignBonusAmount).toBeNull();
      expect(tx?.campaignId).toBeNull();
    });

    it('campaña PERCENT activa → congela ceil(creditAmount * value/100)', async () => {
      const campaign = await prisma.campaign.create({
        data: {
          name: 'H8D1 Test Checkout Percent',
          type: CampaignType.CREDIT_BONUS,
          active: true,
          ...nowWindow(),
          params: { kind: 'PERCENT', value: 30 },
        },
      });

      await redsysService.createCreditPackCheckout(regularUserId, { packId: packBasicoId });

      const tx = await prisma.transaction.findFirst({
        where: { userId: regularUserId, status: TransactionStatus.PENDING },
        orderBy: { createdAt: 'desc' },
      });
      const expected = Math.ceil((packBasicoCreditAmount * 30) / 100); // ceil(50*30/100)=15
      expect(tx?.campaignBonusAmount).toBe(expected);
      expect(tx?.campaignId).toBe(campaign.id);
    });

    it('campaña FIXED activa → congela el valor fijo', async () => {
      const campaign = await prisma.campaign.create({
        data: {
          name: 'H8D1 Test Checkout Fixed',
          type: CampaignType.CREDIT_BONUS,
          active: true,
          ...nowWindow(),
          params: { kind: 'FIXED', value: 25 },
        },
      });

      await redsysService.createCreditPackCheckout(regularUserId, { packId: packBasicoId });

      const tx = await prisma.transaction.findFirst({
        where: { userId: regularUserId, status: TransactionStatus.PENDING },
        orderBy: { createdAt: 'desc' },
      });
      expect(tx?.campaignBonusAmount).toBe(25);
      expect(tx?.campaignId).toBe(campaign.id);
    });

    it('Pro + campaña activa → ambos bonus se congelan por separado (se suman, no se excluyen)', async () => {
      await prisma.campaign.create({
        data: {
          name: 'H8D1 Test Checkout Pro Sum',
          type: CampaignType.CREDIT_BONUS,
          active: true,
          ...nowWindow(),
          params: { kind: 'FIXED', value: 25 },
        },
      });

      await redsysService.createCreditPackCheckout(proUserId, { packId: packBasicoId });

      const tx = await prisma.transaction.findFirst({
        where: { userId: proUserId, status: TransactionStatus.PENDING },
        orderBy: { createdAt: 'desc' },
      });
      const expectedProBonus = Math.ceil((packBasicoCreditAmount * 20) / 100); // proExtraCreditsPercent=20 (seed)
      expect(tx?.bonusCreditAmount).toBe(expectedProBonus);
      expect(tx?.campaignBonusAmount).toBe(25);
    });
  });

  // ── Processor: acreditación del bonus de campaña ───────────────────────────

  describe('Processor — campaign bonus accreditation', () => {
    beforeEach(async () => {
      await prisma.creditLedger.deleteMany({ where: { wallet: { userId: { in: [regularUserId, proUserId] } } } });
      await prisma.wallet.deleteMany({ where: { userId: { in: [regularUserId, proUserId] } } });
    });

    afterEach(async () => {
      await prisma.transaction.deleteMany({ where: { userId: { in: [regularUserId, proUserId] } } });
      await cleanCampaigns();
    });

    it('acredita base + campaña; entrada CAMPAIGN_BONUS en el ledger', async () => {
      const DS_ORDER = '20270101CMPA';
      const campaignBonus = 15;
      const tx = await createPendingTransaction(DS_ORDER, { campaignBonusAmount: campaignBonus });

      await processor.processSuccess({
        transactionId: tx.id,
        dsAmount: correctCents(packBasicoAmountEur),
        dsOrder: DS_ORDER,
      });

      const wallet = await prisma.wallet.findUnique({
        where: { userId: regularUserId },
        include: { entries: true },
      });
      expect(wallet!.balance).toBe(packBasicoCreditAmount + campaignBonus); // 65

      const packEntry = wallet!.entries.find((e) => e.type === CreditLedgerType.PACK_PURCHASE);
      expect(packEntry?.amount).toBe(packBasicoCreditAmount);

      const campaignEntry = wallet!.entries.find((e) => e.type === CreditLedgerType.CAMPAIGN_BONUS);
      expect(campaignEntry).toBeDefined();
      expect(campaignEntry!.amount).toBe(campaignBonus);
      expect(campaignEntry!.referenceType).toBe('Transaction');
      expect(campaignEntry!.referenceId).toBe(tx.id);
    });

    it('Pro + campaña → wallet = base + proBonus + campaignBonus, 3 entradas de ledger', async () => {
      const DS_ORDER = '20270101CMPB';
      const proBonus = 10;
      const campaignBonus = 15;
      const tx = await createPendingTransaction(DS_ORDER, {
        userId: proUserId,
        bonusCreditAmount: proBonus,
        campaignBonusAmount: campaignBonus,
      });

      await processor.processSuccess({
        transactionId: tx.id,
        dsAmount: correctCents(packBasicoAmountEur),
        dsOrder: DS_ORDER,
      });

      const wallet = await prisma.wallet.findUnique({
        where: { userId: proUserId },
        include: { entries: true },
      });
      expect(wallet!.balance).toBe(packBasicoCreditAmount + proBonus + campaignBonus); // 75
      expect(wallet!.entries).toHaveLength(3);
      expect(wallet!.entries.map((e) => e.type).sort()).toEqual(
        [
          CreditLedgerType.PACK_PURCHASE,
          CreditLedgerType.PRO_BONUS,
          CreditLedgerType.CAMPAIGN_BONUS,
        ].sort(),
      );
    });

    it('sin bonus de campaña frozen → sin entrada CAMPAIGN_BONUS (comportamiento actual intacto)', async () => {
      const DS_ORDER = '20270101CMPC';
      const tx = await createPendingTransaction(DS_ORDER);

      await processor.processSuccess({
        transactionId: tx.id,
        dsAmount: correctCents(packBasicoAmountEur),
        dsOrder: DS_ORDER,
      });

      const wallet = await prisma.wallet.findUnique({
        where: { userId: regularUserId },
        include: { entries: true },
      });
      expect(wallet!.balance).toBe(packBasicoCreditAmount);
      expect(wallet!.entries).toHaveLength(1);
      expect(wallet!.entries.find((e) => e.type === CreditLedgerType.CAMPAIGN_BONUS)).toBeUndefined();
    });

    it('el bonus congelado en el checkout vale aunque la campaña se desactive antes del processor', async () => {
      const campaign = await prisma.campaign.create({
        data: {
          name: 'H8D1 Test Race Campaign',
          type: CampaignType.CREDIT_BONUS,
          active: true,
          ...nowWindow(),
          params: { kind: 'FIXED', value: 15 },
        },
      });

      const DS_ORDER = '20270101CMPD';
      // Simulates checkout having frozen the bonus while the campaign was active.
      const tx = await createPendingTransaction(DS_ORDER, {
        campaignBonusAmount: 15,
        campaignId: campaign.id,
      });

      // Campaign deactivated between checkout and gateway confirmation.
      await prisma.campaign.update({ where: { id: campaign.id }, data: { active: false } });

      await processor.processSuccess({
        transactionId: tx.id,
        dsAmount: correctCents(packBasicoAmountEur),
        dsOrder: DS_ORDER,
      });

      const wallet = await prisma.wallet.findUnique({
        where: { userId: regularUserId },
        include: { entries: true },
      });
      // The processor never re-reads Campaign — the frozen 15 still applies.
      expect(wallet!.balance).toBe(packBasicoCreditAmount + 15);
      expect(wallet!.entries.find((e) => e.type === CreditLedgerType.CAMPAIGN_BONUS)?.amount).toBe(15);
    });
  });
});
