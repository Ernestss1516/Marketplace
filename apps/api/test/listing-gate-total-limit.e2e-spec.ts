/**
 * PUERTA — REGLA NUEVA #1: EL LÍMITE TOTAL DE ANUNCIOS.
 *
 * Es la primera regla que la puerta no hereda de nada, y por eso lo que se prueba
 * aquí no es sólo que funcione, sino que funcione COMO SE DECIDIÓ:
 *
 *   · NACE APAGADA. Sin la fila de `Setting`, no frena a nadie. Es la mitad que
 *     protege a los usuarios que ya existen.
 *   · CUENTA EXISTENCIAS, no estados: todo menos `ARCHIVED` y `SOLD`. Archivar y
 *     vender liberan hueco, que es lo que convierte el tope en una tarea con
 *     salida en vez de un muro.
 *   · FRENA AL CREAR, no al publicar. Un `DRAFT` ya cuenta desde que existe;
 *     publicarlo no añade nada al total.
 *   · NO EXPULSA NADA. Un vendedor por encima del tope conserva todos sus
 *     anuncios; sólo no puede sumar otro.
 *   · La cuota de ACTIVOS sigue siendo otra regla, con su propio tope y su propio
 *     mensaje. Conviven.
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import {
  DEFAULT_FREE_TOTAL_LIMIT,
  FREE_ACTIVE_LIMIT_SETTING,
  FREE_TOTAL_LIMIT_SETTING,
  TOTAL_LIMIT_RULE_ENABLED_SETTING,
} from 'src/modules/listing-gate/listing-limits';

/** El tope total del plan gratuito por defecto (2× los 5 activos). */
const TOPE = DEFAULT_FREE_TOTAL_LIMIT;

describe('Puerta — regla #1: el límite TOTAL de anuncios (e2e)', () => {
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
      data: { email: 'total-seller@example.com', name: 'Total Seller', slug: 'total-seller', passwordHash, emailVerified: true },
    });
    sellerId = seller.id;
    await prisma.user.create({
      data: { email: 'total-admin@example.com', name: 'Total Admin', slug: 'total-admin', passwordHash, emailVerified: true, role: 'ADMIN' },
    });

    const [s, a] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'total-seller@example.com', password: 'Test1234!' }),
      request(app.getHttpServer()).post('/api/auth/admin-login').send({ email: 'total-admin@example.com', password: 'Test1234!' }),
    ]);
    sellerToken = s.body.accessToken as string;
    adminToken = a.body.accessToken as string;
  });

  afterEach(async () => {
    // La regla vuelve a APAGADA y los topes a «sin configurar» — `Setting` es
    // dato de sistema compartido entre suites y `cleanDb` no lo limpia.
    await prisma.setting.deleteMany({
      where: { key: { in: [TOTAL_LIMIT_RULE_ENABLED_SETTING, FREE_TOTAL_LIMIT_SETTING] } },
    });
    await prisma.listing.deleteMany({ where: { sellerId } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ===========================================================================
  // Utilidades
  // ===========================================================================

  async function encenderRegla(): Promise<void> {
    await prisma.setting.upsert({
      where: { key: TOTAL_LIMIT_RULE_ENABLED_SETTING },
      create: { key: TOTAL_LIMIT_RULE_ENABLED_SETTING, value: true },
      update: { value: true },
    });
  }

  let n = 0;
  async function seedListings(status: ListingStatus, cuantos: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < cuantos; i++) {
      n += 1;
      const l = await prisma.listing.create({
        data: {
          title: `Total ${n}`,
          slug: `total-limite-${n}-${Date.now()}`,
          description: 'Anuncio de la suite del límite total',
          price: new Prisma.Decimal('10.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status,
          sellerId,
          categoryId,
          ...(status === ListingStatus.ACTIVE || status === ListingStatus.EXPIRED
            ? { publishedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 86_400_000) }
            : {}),
        },
        select: { id: true },
      });
      ids.push(l.id);
    }
    return ids;
  }

  /** Intenta crear un anuncio nuevo por la API y devuelve la respuesta cruda. */
  function crear() {
    n += 1;
    return request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: `Anuncio nuevo ${n}`,
        description: 'El que intenta entrar',
        price: 10,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId,
        city: 'Madrid',
        province: 'Madrid',
        latitude: 40.4168,
        longitude: -3.7038,
      });
  }

  // ===========================================================================
  // 1 · NACE APAGADA
  // ===========================================================================

  describe('Apagada (como nace)', () => {
    it('un vendedor MUY por encima del tope crea sin problema', async () => {
      // El doble del tope. Con la regla encendida esto sería un 403; apagada, la
      // puerta no consulta ni cuenta.
      await seedListings(ListingStatus.DRAFT, TOPE * 2);

      await crear().expect(201);
    });
  });

  // ===========================================================================
  // 2 · ENCENDIDA — el freno, y dónde se aplica
  // ===========================================================================

  describe('Encendida', () => {
    it('justo por debajo del tope todavía se puede crear', async () => {
      await seedListings(ListingStatus.DRAFT, TOPE - 1);
      await encenderRegla();

      // CONTROL POSITIVO: sin él, una regla que frenara SIEMPRE pasaría el test
      // de abajo y parecería correcta.
      await crear().expect(201);
    });

    it('en el tope → 403 con el motivo y la SALIDA', async () => {
      await seedListings(ListingStatus.DRAFT, TOPE);
      await encenderRegla();

      const res = await crear().expect(403);
      expect(res.body.code).toBe('TOTAL_LIMIT_REACHED');
      expect(res.body.message).toContain(`${TOPE}`);
      // El mensaje dice qué hacer, no sólo que no se puede.
      expect(res.body.message).toMatch(/archiva/i);
      expect(res.body.reasons).toHaveLength(1);
      expect(res.body.reasons[0].code).toBe('TOTAL_LIMIT_REACHED');
    });

    it('NO EXPULSA NADA: el vendedor en el tope conserva todos sus anuncios', async () => {
      const ids = await seedListings(ListingStatus.DRAFT, TOPE);
      await encenderRegla();

      await crear().expect(403);

      // Es un límite de ENTRADA. Ni uno solo de los que ya tenía cambia.
      const siguen = await prisma.listing.count({ where: { id: { in: ids } } });
      expect(siguen).toBe(TOPE);
      const marcados = await prisma.listing.count({
        where: { id: { in: ids }, needsRevalidation: true },
      });
      expect(marcados).toBe(0);
    });

    it('PUBLICAR un borrador existente NO lo frena: ya contaba', async () => {
      // El tope limita cuántos anuncios EXISTEN. Publicar no añade ninguno —
      // sólo cambia de estado uno que ya estaba dentro del recuento. Frenar aquí
      // cobraría dos veces por el mismo anuncio y dejaría borradores imposibles
      // de publicar.
      const [borrador] = await seedListings(ListingStatus.DRAFT, 1);
      await seedListings(ListingStatus.DRAFT, TOPE - 1); // total = TOPE, en el tope
      await encenderRegla();

      // Crear otro sí se frena…
      await crear().expect(403);
      // …pero publicar el que ya tenía, no.
      await request(app.getHttpServer())
        .post(`/api/listings/${borrador}/publish`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);
    });
  });

  // ===========================================================================
  // 3 · QUÉ CUENTA — y por qué eso da una salida
  // ===========================================================================

  describe('Qué cuenta hacia el total', () => {
    it('ARCHIVED y SOLD no cuentan: con el doble del tope archivado se puede crear', async () => {
      await seedListings(ListingStatus.ARCHIVED, TOPE);
      await seedListings(ListingStatus.SOLD, TOPE);
      await encenderRegla();

      await crear().expect(201);
    });

    it('ARCHIVAR uno libera hueco de verdad', async () => {
      const ids = await seedListings(ListingStatus.PAUSED, TOPE);
      await encenderRegla();

      await crear().expect(403);

      // La salida que promete el mensaje, por la API del vendedor.
      await request(app.getHttpServer())
        .post(`/api/listings/${ids[0]}/archive`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      await crear().expect(201);
    });

    it('los estados intermedios SÍ cuentan (un EXPIRED ocupa sitio)', async () => {
      // Caducar no es lo mismo que archivar: el anuncio sigue siendo del
      // vendedor y puede renovarlo, así que sigue ocupando.
      await seedListings(ListingStatus.EXPIRED, TOPE);
      await encenderRegla();

      await crear().expect(403);
    });
  });

  // ===========================================================================
  // 4 · CONVIVENCIA con la cuota de activos — son DOS reglas
  // ===========================================================================

  it('la cuota de ACTIVOS sigue siendo otra regla, con su propio código', async () => {
    // 5 activos = tope de activos, pero sólo 5 de 10 del total: el vendedor está
    // en un límite y no en el otro. Publicar falla por ACTIVE_LIMIT_REACHED, y
    // crear —que el límite total no frena todavía— pasa.
    await seedListings(ListingStatus.ACTIVE, 5);
    const [borrador] = await seedListings(ListingStatus.DRAFT, 1);
    await encenderRegla();

    const publicar = await request(app.getHttpServer())
      .post(`/api/listings/${borrador}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(403);
    expect(publicar.body.code).toBe('ACTIVE_LIMIT_REACHED');

    // Total = 6 de 10: todavía hay sitio.
    await crear().expect(201);
  });

  // ===========================================================================
  // 5 · LOS TOPES SON CONFIGURABLES, y coherentes
  // ===========================================================================

  describe('Los topes, desde el backoffice', () => {
    it('el tope se lee del Setting, no del default', async () => {
      await prisma.setting.upsert({
        where: { key: FREE_TOTAL_LIMIT_SETTING },
        create: { key: FREE_TOTAL_LIMIT_SETTING, value: 6 },
        update: { value: 6 },
      });
      await seedListings(ListingStatus.DRAFT, 6);
      await encenderRegla();

      const res = await crear().expect(403);
      expect(res.body.message).toContain('6');
    });

    it('rechaza un tope TOTAL que no supere al de activos', async () => {
      // Activos por defecto = 5. Un total de 5 prometería cinco plazas de
      // escaparate que no se podrían llegar a crear.
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/settings/${FREE_TOTAL_LIMIT_SETTING}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 5 })
        .expect(400);
      expect(res.body.message).toMatch(/mayor que el de anuncios activos/i);
    });

    it('rechaza también por el otro lado: subir ACTIVOS por encima del total', async () => {
      // La misma incoherencia se fabrica desde la otra clave, así que la guarda
      // mira en las dos direcciones.
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/settings/${FREE_ACTIVE_LIMIT_SETTING}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: DEFAULT_FREE_TOTAL_LIMIT })
        .expect(400);
      expect(res.body.message).toMatch(/mayor que el de anuncios activos/i);
    });

    it('acepta un par coherente', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/settings/${FREE_TOTAL_LIMIT_SETTING}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 12 })
        .expect(200);
    });

    it('subiendo ANTES el total, subir los activos sí se acepta', async () => {
      // REGRESIÓN. Este es el orden que la guarda impone, y no es un detalle
      // teórico: el CI lo encontró de la peor manera. El entorno de Playwright
      // sube el límite de activos a 100 para que los tests puedan publicar sin
      // topar, pero dejaba los totales sin configurar (default 10). Una spec
      // bajaba activos a 7 y, al RESTAURARLO a 100, el backend lo rechazaba —
      // correctamente—. La spec dejaba el límite en 7 y toda spec posterior que
      // publicara más de siete anuncios moría con un ACTIVE_LIMIT_REACHED que no
      // tenía nada que ver con lo que probaba.
      //
      // La guarda estaba bien; lo que faltaba era subir primero el total. Queda
      // fijado aquí para que el orden correcto sea algo que se pueda leer.
      await request(app.getHttpServer())
        .patch(`/api/admin/settings/${FREE_TOTAL_LIMIT_SETTING}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 500 })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/admin/settings/${FREE_ACTIVE_LIMIT_SETTING}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 100 })
        .expect(200);

      // Se restaura el de activos a mano: es una clave COMPARTIDA con otras
      // suites y `cleanDb` no toca `Setting` (el `afterEach` sólo limpia las
      // claves nuevas, que son de esta ráfaga).
      await request(app.getHttpServer())
        .patch(`/api/admin/settings/${FREE_ACTIVE_LIMIT_SETTING}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 5 })
        .expect(200);
    });
  });
});
