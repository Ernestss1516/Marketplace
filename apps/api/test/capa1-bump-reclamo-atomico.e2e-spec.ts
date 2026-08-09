/**
 * CAPA 1 — el reclamo atómico del cooldown del bump (e2e).
 *
 * EL DEFECTO (deuda preexistente del bump MANUAL, no del bump automático): `BillingService.bump`
 * comprobaba el cooldown LEYENDO `bumpedAt` fuera de la transacción, y el UPDATE que lo marcaba
 * era la ÚLTIMA sentencia de las tres ramas de cobro. Se cobraba primero y se marcaba después,
 * así que dos ejecuciones concurrentes sobre el mismo anuncio podían leer ambas «no está en
 * cooldown» antes de que ninguna confirmara su escritura — y COBRAR LAS DOS.
 *
 * Con clics humanos hace falta una simultaneidad casi imposible. Con el scheduler del bump
 * automático corriendo en N instancias sería el caso normal, y por eso este arreglo va antes y
 * por separado.
 *
 * ESTA SUITE ES LA PRUEBA DE QUE LA CARRERA ESTÁ CERRADA, y está escrita para FALLAR contra el
 * código anterior: contra la versión que cobraba antes de marcar, los dos bumps concurrentes
 * salían 200 y el monedero perdía el doble. Es la misma clase de prueba que la mutación del
 * reloj en el cron de tickets: no comprueba que el código haga algo, comprueba que YA NO PUEDE
 * hacer lo que hacía.
 *
 * El CONTRATO no se prueba aquí: eso lo fija `uxv1-bump-cooldown.e2e-spec.ts`, que debe seguir
 * verde SIN TOCARLO. Si aquello hubiera que cambiarlo, el arreglo habría dejado de ser interno.
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { BUMP_COOLDOWN_SECONDS } from 'src/modules/billing/bump-cooldown';

const COOLDOWN_MS = BUMP_COOLDOWN_SECONDS * 1000;

describe('CAPA 1 — reclamo atómico del cooldown: un turno, un cobro (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let sellerId: string;
  let token: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const seller = await prisma.user.create({
      data: {
        email: 'capa1-seller@example.com',
        name: 'CAPA1 Seller',
        slug: 'capa1-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    sellerId = seller.id;

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'capa1-seller@example.com', password: 'Test1234!' });
    token = res.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  /** Deja el monedero del vendedor exactamente como pide cada caso. */
  async function setWallet(balance: number, bumpBalance = 0) {
    await prisma.wallet.upsert({
      where: { userId: sellerId },
      create: { userId: sellerId, balance, bumpBalance },
      update: { balance, bumpBalance },
    });
  }

  /**
   * Sin nada con que pagar. Se deja el monedero a cero en vez de borrarlo: una vez hay
   * apuntes en el libro mayor la fila no se puede borrar (FK de CreditLedger), y da igual
   * —las tres bolsas vacías son las tres bolsas vacías—. El vendedor no es Pro, así que
   * tampoco hay cuota que gastar.
   */
  async function sinSaldo() {
    await setWallet(0, 0);
  }

  async function createActiveListing(suffix: string, bumpedAt: Date | null = null) {
    return prisma.listing.create({
      data: {
        title: `CAPA1 listing ${suffix}`,
        slug: `capa1-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: 'E2e listing para el reclamo atómico del cooldown',
        price: new Prisma.Decimal('100.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        sellerId,
        categoryId,
        publishedAt: new Date(),
        ...(bumpedAt && { bumpedAt }),
      },
      select: { id: true, slug: true },
    });
  }

  /** N bumps del MISMO anuncio disparados a la vez, sin esperar unos por otros. */
  async function bumpsConcurrentes(listingId: string, n: number): Promise<number[]> {
    const peticiones = Array.from({ length: n }, () =>
      request(app.getHttpServer())
        .post(`/api/listings/${listingId}/bump`)
        .set('Authorization', `Bearer ${token}`),
    );
    const res = await Promise.all(peticiones.map((p) => p.then((r) => r.status)));
    return res;
  }

  const movimientosDeCredito = (listingId: string) =>
    prisma.creditLedger.findMany({
      where: { type: 'BUMP_DEBIT', referenceType: 'Listing', referenceId: listingId },
    });

  const movimientosDeBumps = (listingId: string) =>
    prisma.bumpLedger.findMany({
      where: { referenceType: 'Listing', referenceId: listingId },
    });

  // ---------------------------------------------------------------------------
  // 1. La carrera, con créditos
  // ---------------------------------------------------------------------------

  it('dos bumps a la vez del mismo anuncio: uno pasa, el otro choca con el cooldown', async () => {
    await setWallet(500);
    const { id } = await createActiveListing('carrera-2');

    const estados = await bumpsConcurrentes(id, 2);

    expect(estados.filter((s) => s === 200)).toHaveLength(1);
    expect(estados.filter((s) => s === 429)).toHaveLength(1);
  });

  it('y el monedero solo paga UNA vez — que es lo que de verdad importa', async () => {
    await setWallet(500);
    const { id } = await createActiveListing('carrera-dinero');

    await bumpsConcurrentes(id, 2);

    // Un solo apunte contable para este anuncio. Con el código anterior había dos.
    const movimientos = await movimientosDeCredito(id);
    expect(movimientos).toHaveLength(1);

    // Y el saldo bajó exactamente lo que dice ese único apunte, ni un crédito más.
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sellerId } });
    expect(wallet.balance).toBe(500 + movimientos[0].amount); // amount es negativo
  });

  it('cinco a la vez tampoco cuelan: sigue habiendo un único cobro', async () => {
    await setWallet(500);
    const { id } = await createActiveListing('carrera-5');

    const estados = await bumpsConcurrentes(id, 5);

    expect(estados.filter((s) => s === 200)).toHaveLength(1);
    expect(estados.filter((s) => s === 429)).toHaveLength(4);
    expect(await movimientosDeCredito(id)).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 2. La carrera, con saldo de bumps (la otra moneda, con su invariante)
  // ---------------------------------------------------------------------------

  it('con saldo de bumps, la concurrencia tampoco gasta dos: y el invariante aguanta', async () => {
    await setWallet(0, 10);
    const { id } = await createActiveListing('carrera-bumps');

    const estados = await bumpsConcurrentes(id, 3);
    expect(estados.filter((s) => s === 200)).toHaveLength(1);

    // Un solo BUMP_DEBIT de -1.
    const movimientos = await movimientosDeBumps(id);
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0].amount).toBe(-1);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sellerId } });
    expect(wallet.bumpBalance).toBe(9);

    // INVARIANTE del esquema: wallet.bumpBalance == SUM(BumpLedger.amount) de ese monedero.
    // Un cobro sin apunte —o dos apuntes por un cobro— lo rompería aquí.
    const agregado = await prisma.bumpLedger.aggregate({
      where: { walletId: wallet.id },
      _sum: { amount: true },
    });
    expect(wallet.bumpBalance).toBe(10 + (agregado._sum.amount ?? 0));
  });

  // ---------------------------------------------------------------------------
  // 3. Atomicidad en la otra dirección: ni marca sin cobrar, ni cobra sin marcar
  // ---------------------------------------------------------------------------

  it('un intento SIN saldo no consume la ventana: el reclamo revierte con el cobro', async () => {
    await sinSaldo(); // ni créditos, ni saldo de bumps, ni cuota Pro
    const { id } = await createActiveListing('sin-saldo');

    await request(app.getHttpServer())
      .post(`/api/listings/${id}/bump`)
      .set('Authorization', `Bearer ${token}`)
      .expect(402);

    // Si el reclamo se hubiera quedado escrito, el anuncio estaría en cooldown por un
    // bump que NUNCA se cobró — y el usuario tendría que esperar una hora por nada.
    const tras402 = await prisma.listing.findUniqueOrThrow({
      where: { id },
      select: { bumpedAt: true },
    });
    expect(tras402.bumpedAt).toBeNull();

    // Y en cuanto hay saldo, el bump entra a la primera.
    await setWallet(500);
    await request(app.getHttpServer())
      .post(`/api/listings/${id}/bump`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const trasCobro = await prisma.listing.findUniqueOrThrow({
      where: { id },
      select: { bumpedAt: true },
    });
    expect(trasCobro.bumpedAt).not.toBeNull();
    expect(await movimientosDeCredito(id)).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 4. El rechazo sigue siendo el de siempre (secuencial, sin concurrencia)
  // ---------------------------------------------------------------------------

  it('dentro de la ventana rechaza con 429 y retryAfter, y no toca el saldo', async () => {
    await setWallet(500);
    const { id } = await createActiveListing('en-ventana', new Date());

    const res = await request(app.getHttpServer())
      .post(`/api/listings/${id}/bump`)
      .set('Authorization', `Bearer ${token}`)
      .expect(429);

    expect(res.body.retryAfter).toBeGreaterThan(0);
    expect(res.body.retryAfter).toBeLessThanOrEqual(BUMP_COOLDOWN_SECONDS);

    expect(await movimientosDeCredito(id)).toHaveLength(0);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: sellerId } });
    expect(wallet.balance).toBe(500);
  });

  it('justo pasada la ventana el reclamo se concede', async () => {
    await setWallet(500);
    const { id } = await createActiveListing(
      'ventana-vencida',
      new Date(Date.now() - (COOLDOWN_MS + 60_000)),
    );

    await request(app.getHttpServer())
      .post(`/api/listings/${id}/bump`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(await movimientosDeCredito(id)).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 5. El reclamo es POR ANUNCIO, no un candado global
  // ---------------------------------------------------------------------------

  it('dos anuncios distintos a la vez se bumpean los dos: no se serializa de más', async () => {
    await setWallet(500);
    const a = await createActiveListing('paralelo-a');
    const b = await createActiveListing('paralelo-b');

    const [ra, rb] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/listings/${a.id}/bump`)
        .set('Authorization', `Bearer ${token}`),
      request(app.getHttpServer())
        .post(`/api/listings/${b.id}/bump`)
        .set('Authorization', `Bearer ${token}`),
    ]);

    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect(await movimientosDeCredito(a.id)).toHaveLength(1);
    expect(await movimientosDeCredito(b.id)).toHaveLength(1);
  });
});
