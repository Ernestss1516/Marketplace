import * as fs from 'fs';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { waitForIndex } from './helpers/meili';
import { SearchService } from '../src/modules/search/search.service';
import { ListingsService } from '../src/modules/listings/listings.service';
import { ModerationService } from '../src/modules/moderation/moderation.service';
import { AdminService } from '../src/modules/admin/admin.service';
import { CouponsService } from '../src/modules/coupons/coupons.service';
import { ExpirationService } from '../src/modules/expiration/expiration.service';
import { ListingActivationService } from '../src/modules/listing-activation/listing-activation.service';
import { BillingService } from '../src/modules/billing/billing.service';
import { StripeWebhookGuard } from '../src/modules/billing/guards/stripe-webhook.guard';
import { RedsysWebhookGuard } from '../src/modules/redsys/guards/redsys-webhook.guard';
import { MediaService } from '../src/modules/media/media.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { ContactService } from '../src/modules/contact/contact.service';

/**
 * Deuda: "retry fantasma de QUEUE_INDEXING". Cada módulo que llama
 * BullModule.registerQueue({name}) crea su PROPIA instancia Queue (productor);
 * el defaultJobOptions de queue.module.ts no llega a esa instancia. Confirmado
 * primero para QUEUE_NOTIFICATIONS (AuthService/AlertMatchingService), y aquí
 * para QUEUE_INDEXING (7 módulos), QUEUE_BILLING (BillingModule se
 * re-registraba a sí mismo sin retry) y QUEUE_REDSYS/QUEUE_IMAGE (sin retry
 * en ningún sitio, ni siquiera en queue.module.ts). Fix: helper retryQueue()
 * en queue.constants.ts, aplicado en todos los registerQueue() reales.
 */
describe('Retry de colas BullMQ (e2e)', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Guard estructural — sin app, puro análisis de fuente. Si un módulo nuevo
  // vuelve a registrar una cola con `{ name: ... }` a pelo (sin retryQueue()),
  // este test falla antes de que el bug pueda llegar a producción en silencio.
  // ═══════════════════════════════════════════════════════════════════════
  it('ningún *.module.ts registra una cola con { name: ... } saltándose retryQueue()', () => {
    const srcDir = path.join(__dirname, '..', 'src');
    const offenders: string[] = [];
    const rawPattern = /registerQueue\(\s*\{\s*name\s*:/;

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.module.ts')) {
          const content = fs.readFileSync(full, 'utf8');
          if (rawPattern.test(content)) {
            offenders.push(path.relative(srcDir, full));
          }
        }
      }
    };
    walk(srcDir);

    expect(offenders).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Verificación en ejecución: la instancia de Queue que CADA productor real
  // usa de verdad para encolar (el campo privado inyectado en su servicio),
  // no la de queue.module.ts, lleva attempts:3 + backoff. select()+strict no
  // sirve aquí: el provider de registerQueue() vive en un submódulo dinámico
  // que strict:true no atraviesa, así que se lee directamente del servicio
  // que hace .add() en producción — la fuente de verdad real del bug.
  // ═══════════════════════════════════════════════════════════════════════
  describe('Cada productor real tiene retry configurado en su propia instancia de Queue', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApp();
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    const cases: Array<[string, unknown, string]> = [
      ['ListingsService (QUEUE_INDEXING, ListingsModule)', ListingsService, 'indexingQueue'],
      ['ModerationService (QUEUE_INDEXING, ModerationModule)', ModerationService, 'indexingQueue'],
      ['AdminService (QUEUE_INDEXING, AdminModule)', AdminService, 'indexingQueue'],
      ['CouponsService (QUEUE_INDEXING, CouponsModule)', CouponsService, 'indexingQueue'],
      ['ExpirationService (QUEUE_INDEXING, ExpirationModule)', ExpirationService, 'indexingQueue'],
      ['ListingActivationService (QUEUE_INDEXING, ListingActivationModule)', ListingActivationService, 'indexingQueue'],
      ['BillingService (QUEUE_INDEXING, BillingModule)', BillingService, 'indexingQueue'],
      ['StripeWebhookGuard (QUEUE_BILLING, BillingModule)', StripeWebhookGuard, 'billingQueue'],
      ['RedsysWebhookGuard (QUEUE_REDSYS, RedsysModule)', RedsysWebhookGuard, 'redsysQueue'],
      ['MediaService (QUEUE_IMAGE, MediaModule)', MediaService, 'imageQueue'],
      ['AuthService (QUEUE_NOTIFICATIONS, AuthModule)', AuthService, 'notificationQueue'],
      ['ContactService (QUEUE_NOTIFICATIONS, ContactModule)', ContactService, 'notificationQueue'],
    ];

    it.each(cases)('%s → attempts:3 + backoff exponencial 2000ms', (_label, providerClass, fieldName) => {
      const instance = app.get(providerClass as new (...args: unknown[]) => unknown);
      const queue = (instance as Record<string, Queue>)[fieldName as string];
      expect(queue).toBeDefined();
      expect(queue.opts.defaultJobOptions?.attempts).toBe(3);
      expect(queue.opts.defaultJobOptions?.backoff).toMatchObject({
        type: 'exponential',
        delay: 2_000,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Prueba de fallo real (no solo por inspección): se fuerza un error
  // transitorio en el primer intento de indexación y se comprueba que
  // BullMQ reintenta hasta indexar el anuncio, en vez de perderlo en
  // silencio (que era exactamente el síntoma del bug: anuncio ACTIVE que
  // nunca aparece en /api/search).
  //
  // publish() encola el job 'index' vía ListingActivationService (no vía
  // ListingsService.indexingQueue directamente — publish() delega en
  // activation.listingBecameActive()), así que esto ejercita en concreto el
  // productor de ListingActivationModule + IndexingProcessor end-to-end. Que
  // CADA módulo productor (los 12 casos de arriba) tenga retry declarado ya
  // queda demostrado por inspección directa de instancia (y se confirmó que
  // ese test SÍ falla si se revierte el fix en cualquiera de ellos); esta
  // prueba demuestra que la config declarada realmente coopera con BullMQ
  // para reintentar un job real, no solo que el objeto esté bien formado.
  // ═══════════════════════════════════════════════════════════════════════
  describe('Retry real: un fallo transitorio en indexación no pierde el anuncio', () => {
    let app: INestApplication;
    let prisma: PrismaClient;
    let meili: MeiliSearch;
    let search: SearchService;
    let sellerToken: string;
    let categoryId: string;

    beforeAll(async () => {
      prisma = new PrismaClient();
      meili = buildMeiliClient();
      app = await createTestApp();
      await app.init();

      await cleanDb(prisma);
      await resetMeili(meili);

      search = app.get(SearchService);

      const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
      categoryId = category.id;

      await prisma.user.create({
        data: {
          email: 'qretry-seller@example.com',
          name: 'qretry-seller',
          slug: 'qretry-seller',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      });
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'qretry-seller@example.com', password: 'Test1234!' });
      sellerToken = login.body.accessToken as string;
    });

    afterAll(async () => {
      await app.close();
      await prisma.$disconnect();
    });

    it('SearchService.indexListing() falla en el primer intento → BullMQ reintenta y el anuncio SÍ acaba indexado', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          title: 'Anuncio retry real indexacion',
          description: 'Prueba de retry real forzando un fallo transitorio de indexación',
          price: 150,
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          categoryId,
          city: 'Madrid',
          province: 'Madrid',
          latitude: 40.4168,
          longitude: -3.7038,
          attributes: {},
        })
        .expect(201);
      const listingId = createRes.body.id as string;

      const originalIndexListing = search.indexListing.bind(search);
      let attempts = 0;
      const spy = jest.spyOn(search, 'indexListing').mockImplementation(async (listing) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Fallo simulado (Meili caído) — primer intento de indexación');
        }
        return originalIndexListing(listing);
      });

      try {
        await request(app.getHttpServer())
          .post(`/api/listings/${listingId}/publish`)
          .set('Authorization', `Bearer ${sellerToken}`)
          .expect(200);

        // Sin retry real, el job muere en el primer intento y esto agota el
        // timeout (el bug original: el anuncio se queda INVISIBLE en
        // silencio). Con retry real, el segundo intento (tras el backoff
        // exponencial) llama a la implementación real y lo indexa.
        await waitForIndex(meili, process.env.MEILI_INDEX_NAME!, listingId);

        expect(attempts).toBeGreaterThanOrEqual(2);
      } finally {
        spy.mockRestore();
      }
    }, 20_000);
  });
});
