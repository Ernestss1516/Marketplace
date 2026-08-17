/**
 * PUERTA — REGLA NUEVA #3: LOS LÍMITES DE FOTOS.
 *
 * Son DOS COSAS con distinto riesgo, y la suite las separa igual que el código:
 *
 *  · EL MÁXIMO es una MIGRACIÓN: los mismos 15 de siempre, que dejan de estar
 *    clavados en dos DTOs (y en React) para salir de un `Setting`. Lo que hay que
 *    demostrar es que 15 SIGUE SIENDO 15 y que ahora el número se lee de verdad
 *    del ajuste — no de una constante que resulta que vale lo mismo.
 *  · EL MÍNIMO es una REGLA NUEVA, apagada. Apagada no exige nada (que es el
 *    comportamiento de hoy: la interfaz lo pide, el servidor no); encendida, un
 *    anuncio sin fotos no se publica.
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import {
  DEFAULT_MAX_PHOTOS,
  MAX_PHOTOS_SETTING,
  MIN_PHOTOS_RULE_ENABLED_SETTING,
  MIN_PHOTOS_SETTING,
  NOT_ENOUGH_PHOTOS_CODE,
} from 'src/modules/listing-gate/photo-limits';

describe('Puerta — regla #3: límites de fotos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;
  let sellerId: string;
  let sellerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = cat.id;

    const passwordHash = await bcrypt.hash('Test1234!', 4);
    const seller = await prisma.user.create({
      data: { email: 'fotos-seller@example.com', name: 'Fotos Seller', slug: 'fotos-seller', passwordHash, emailVerified: true },
    });
    sellerId = seller.id;
    await prisma.user.create({
      data: { email: 'fotos-admin@example.com', name: 'Fotos Admin', slug: 'fotos-admin', passwordHash, emailVerified: true, role: 'ADMIN' },
    });

    const [s, a] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'fotos-seller@example.com', password: 'Test1234!' }),
      request(app.getHttpServer()).post('/api/auth/admin-login').send({ email: 'fotos-admin@example.com', password: 'Test1234!' }),
    ]);
    sellerToken = s.body.accessToken as string;
    adminToken = a.body.accessToken as string;
  });

  afterEach(async () => {
    await prisma.setting.deleteMany({
      where: { key: { in: [MAX_PHOTOS_SETTING, MIN_PHOTOS_SETTING, MIN_PHOTOS_RULE_ENABLED_SETTING] } },
    });
    await prisma.listingImage.deleteMany({ where: { uploadedById: sellerId } });
    await prisma.listing.deleteMany({ where: { sellerId } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ===========================================================================
  // Utilidades
  // ===========================================================================

  async function fijarAjuste(key: string, value: number | boolean): Promise<void> {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: value as never },
      update: { value: value as never },
    });
  }

  let n = 0;
  /** Imágenes sueltas del vendedor, listas para vincular a un anuncio. */
  async function subirFotos(cuantas: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < cuantas; i++) {
      n += 1;
      const img = await prisma.listingImage.create({
        data: { url: `https://example.test/foto-${n}.jpg`, uploadedById: sellerId },
        select: { id: true },
      });
      ids.push(img.id);
    }
    return ids;
  }

  function crear(imageIds?: string[]) {
    n += 1;
    return request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: `Anuncio con fotos ${n}`,
        description: 'Anuncio de la suite de fotos',
        price: 10,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId,
        city: 'Madrid',
        province: 'Madrid',
        latitude: 40.4168,
        longitude: -3.7038,
        ...(imageIds ? { imageIds } : {}),
      });
  }

  async function seedDraft(conFotos: number): Promise<string> {
    n += 1;
    const l = await prisma.listing.create({
      data: {
        title: `Borrador fotos ${n}`,
        slug: `borrador-fotos-${n}-${Date.now()}`,
        description: 'x',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.DRAFT,
        sellerId,
        categoryId,
      },
      select: { id: true },
    });
    for (const id of await subirFotos(conFotos)) {
      await prisma.listingImage.update({ where: { id }, data: { listingId: l.id } });
    }
    return l.id;
  }

  function publicar(id: string) {
    return request(app.getHttpServer())
      .post(`/api/listings/${id}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`);
  }

  // ===========================================================================
  // 1 · EL MÁXIMO — la migración, y que ahora se lee del ajuste
  // ===========================================================================

  describe('El máximo', () => {
    it('sigue siendo 15: con 15 fotos se crea, con 16 se rechaza', async () => {
      // BYTE-IDÉNTICO. Es lo único que había que demostrar de la migración: el
      // tope no se ha movido, sólo ha cambiado de sitio.
      await crear(await subirFotos(DEFAULT_MAX_PHOTOS)).expect(201);

      const res = await crear(await subirFotos(DEFAULT_MAX_PHOTOS + 1)).expect(422);
      expect(res.body.message).toContain(`${DEFAULT_MAX_PHOTOS}`);
    });

    it('SE LEE DEL AJUSTE: con el tope en 3, cuatro fotos se rechazan y tres pasan', async () => {
      // La prueba de que el número sale del `Setting` y no de una constante que
      // resulta valer lo mismo. Sin esto, «15 sigue siendo 15» pasaría igual con
      // el número clavado a fuego.
      await fijarAjuste(MAX_PHOTOS_SETTING, 3);

      const res = await crear(await subirFotos(4)).expect(422);
      expect(res.body.message).toContain('3');

      await crear(await subirFotos(3)).expect(201);
    });

    it('también se aplica al EDITAR, no sólo al crear', async () => {
      const id = await seedDraft(0);
      await fijarAjuste(MAX_PHOTOS_SETTING, 2);

      await request(app.getHttpServer())
        .patch(`/api/listings/${id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ imageIds: await subirFotos(3) })
        .expect(422);
    });

    it('`GET /listings/photo-limits` sirve lo que el servidor aplica', async () => {
      // El endpoint existe para que la interfaz no lleve su propia copia del
      // número. Si dijera otra cosa que el validador, volveríamos al problema.
      const porDefecto = await request(app.getHttpServer())
        .get('/api/listings/photo-limits')
        .expect(200);
      expect(porDefecto.body).toEqual({ max: DEFAULT_MAX_PHOTOS, min: 1, minEnforced: false });

      await fijarAjuste(MAX_PHOTOS_SETTING, 7);
      await fijarAjuste(MIN_PHOTOS_RULE_ENABLED_SETTING, true);

      const tocado = await request(app.getHttpServer())
        .get('/api/listings/photo-limits')
        .expect(200);
      expect(tocado.body).toEqual({ max: 7, min: 1, minEnforced: true });
    });
  });

  // ===========================================================================
  // 2 · EL MÍNIMO — la regla nueva, apagada
  // ===========================================================================

  describe('El mínimo', () => {
    it('APAGADO (como nace): un anuncio SIN fotos se publica, igual que hoy', async () => {
      const id = await seedDraft(0);

      const res = await publicar(id).expect(200);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('ENCENDIDO: sin fotos no se publica, y el aviso dice qué hacer', async () => {
      const id = await seedDraft(0);
      await fijarAjuste(MIN_PHOTOS_RULE_ENABLED_SETTING, true);

      const res = await publicar(id).expect(422);
      expect(res.body.code).toBe(NOT_ENOUGH_PHOTOS_CODE);
      expect(res.body.message).toMatch(/al menos 1 foto/i);
      expect(res.body.reasons[0].field).toBe('imageIds');

      // Sigue en borrador: no se ha perdido nada.
      const fila = await prisma.listing.findUniqueOrThrow({ where: { id }, select: { status: true } });
      expect(fila.status).toBe(ListingStatus.DRAFT);
    });

    it('ENCENDIDO: con una foto se publica (control positivo)', async () => {
      const id = await seedDraft(1);
      await fijarAjuste(MIN_PHOTOS_RULE_ENABLED_SETTING, true);

      const res = await publicar(id).expect(200);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('ENCENDIDO con mínimo 2: una foto no basta, dos sí', async () => {
      await fijarAjuste(MIN_PHOTOS_RULE_ENABLED_SETTING, true);
      await fijarAjuste(MIN_PHOTOS_SETTING, 2);

      const conUna = await seedDraft(1);
      const res = await publicar(conUna).expect(422);
      // Con más de una, el mensaje dice cuántas hay: sin ese número el vendedor
      // no sabe cuántas le faltan.
      expect(res.body.message).toMatch(/al menos 2 fotos/i);
      expect(res.body.message).toMatch(/ahora tiene 1/i);

      const conDos = await seedDraft(2);
      await publicar(conDos).expect(200);
    });

    it('ENCENDIDO: RENOVAR un anuncio sin fotos sigue funcionando', async () => {
      // La regla no se aplica hacia atrás. Un anuncio que se publicó cuando no se
      // exigían fotos se puede seguir renovando: mismo principio que el límite
      // total.
      n += 1;
      const caducado = await prisma.listing.create({
        data: {
          title: `Caducado sin fotos ${n}`,
          slug: `caducado-sin-fotos-${n}-${Date.now()}`,
          description: 'x',
          price: new Prisma.Decimal('10.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: ListingStatus.EXPIRED,
          sellerId,
          categoryId,
          publishedAt: new Date(Date.now() - 90 * 86_400_000),
          expiresAt: new Date(Date.now() - 86_400_000),
        },
        select: { id: true },
      });
      await fijarAjuste(MIN_PHOTOS_RULE_ENABLED_SETTING, true);

      await request(app.getHttpServer())
        .post(`/api/listings/${caducado.id}/renew`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
    });

    it('ENCENDIDO: crear y editar un borrador SIN fotos sigue permitido', async () => {
      await fijarAjuste(MIN_PHOTOS_RULE_ENABLED_SETTING, true);

      const creado = await crear().expect(201);
      await request(app.getHttpServer())
        .patch(`/api/listings/${creado.body.id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ title: 'Sigo redactando sin fotos' })
        .expect(200);
    });
  });

  // ===========================================================================
  // 3 · LA INVARIANTE min ≤ max
  // ===========================================================================

  describe('La invariante min ≤ max', () => {
    it('rechaza un mínimo mayor que el máximo', async () => {
      await fijarAjuste(MAX_PHOTOS_SETTING, 3);

      const res = await request(app.getHttpServer())
        .patch(`/api/admin/settings/${MIN_PHOTOS_SETTING}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 5 })
        .expect(400);
      expect(res.body.message).toMatch(/no puede superar al máximo/i);
    });

    it('rechaza también por el otro lado: bajar el máximo por debajo del mínimo', async () => {
      await fijarAjuste(MIN_PHOTOS_SETTING, 4);

      await request(app.getHttpServer())
        .patch(`/api/admin/settings/${MAX_PHOTOS_SETTING}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 2 })
        .expect(400);
    });

    it('IGUALES sí valen: min 3 y max 3 es «exactamente tres fotos»', async () => {
      await fijarAjuste(MAX_PHOTOS_SETTING, 3);

      await request(app.getHttpServer())
        .patch(`/api/admin/settings/${MIN_PHOTOS_SETTING}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 3 })
        .expect(200);
    });
  });
});
