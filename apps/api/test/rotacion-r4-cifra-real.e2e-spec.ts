/**
 * ROTACIÓN DE DESTACADOS — R4: la cifra real que ve el vendedor antes de pagar (e2e).
 *
 * R3 dejó la promesa honesta pero GENÉRICA («va alternándose con los demás»). R4 la hace
 * CONCRETA: con cuántos competiría y cuánto saldría. Es la diferencia entre no mentir y ayudar
 * a decidir — el vendedor ve el mercado real antes de pagar.
 *
 * LO QUE SÓLO PUEDE COMPROBAR UN e2e: que el conteo mira lo que dice mirar. La aritmética se
 * fija en un unitario (featured-rotation.spec.ts, con la tabla del §2); aquí se comprueba que N
 * sale de los destacados VIGENTES de LA categoría —ni caducados, ni revocados, ni de otra
 * categoría, ni anuncios que ya no están activos— y que el propio anuncio no se cuenta dos
 * veces.
 *
 * LAS MUTACIONES QUE ESTO MATA:
 *  · contar caducados o revocados → N inflado: se le enseña una categoría más competida de lo
 *    que está, y su cuota sale peor de lo que será. Mentir a la baja también es mentir;
 *  · contar toda la plataforma en vez de su categoría → una cifra que no significa nada;
 *  · calcular la cuota sin incluir al que pregunta → con cuatro vigentes diría «saldrás
 *    siempre», y en cuanto pague serían cinco y saldría media jornada.
 */

import { INestApplication } from '@nestjs/common';
import { EntitlementType, ListingStatus, PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('ROTACIÓN R4 — la cifra real en el diálogo de compra (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let token: string;
  let userId: string;
  let otroUserId: string;
  /** Cada escenario estrena categoría: el conteo es POR categoría, así que compartirla las
   *  mezclaría y el test dejaría de decir lo que dice. */
  let coches: string;
  let otraCategoria: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();

    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 4);
    const user = await prisma.user.create({
      data: {
        email: 'rota-r4@example.com',
        name: 'RotaR4',
        slug: 'rota-r4',
        passwordHash,
        emailVerified: true,
      },
    });
    userId = user.id;
    const otro = await prisma.user.create({
      data: {
        email: 'rota-r4-otro@example.com',
        name: 'RotaR4 Otro',
        slug: 'rota-r4-otro',
        passwordHash,
        emailVerified: true,
      },
    });
    otroUserId = otro.id;

    coches = await crearCategoria('r4-coches');
    otraCategoria = await crearCategoria('r4-motos');

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'rota-r4@example.com', password: 'Test1234!' });
    token = res.body.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Utillaje
  // ---------------------------------------------------------------------------

  async function crearCategoria(slug: string): Promise<string> {
    const cat = await prisma.category.create({
      data: { name: slug, slug, order: 0, attributeSchema: [] },
    });
    return cat.id;
  }

  async function crearAnuncio(opciones: {
    categoryId: string;
    sellerId?: string;
    status?: ListingStatus;
  }) {
    const slug = `rota-r4-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return prisma.listing.create({
      data: {
        title: 'RotaR4 Anuncio',
        slug,
        description: 'RotaR4',
        price: new Prisma.Decimal('100.00'),
        currency: 'EUR',
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: opciones.status ?? ListingStatus.ACTIVE,
        categoryId: opciones.categoryId,
        sellerId: opciones.sellerId ?? userId,
        publishedAt: new Date(),
      },
    });
  }

  async function destacar(
    listingId: string,
    estado: 'vigente' | 'caducado' | 'revocado' | 'permanente',
  ) {
    const dentroDeUnaSemana = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.FEATURED_LISTING,
        listingId,
        startsAt: new Date(),
        expiresAt:
          estado === 'caducado' ? ayer : estado === 'permanente' ? null : dentroDeUnaSemana,
        revokedAt: estado === 'revocado' ? new Date() : null,
      },
    });
  }

  function competencia(listingId: string, jwt = token) {
    return request(app.getHttpServer())
      .get(`/api/billing/featured-competition/${listingId}`)
      .set('Authorization', `Bearer ${jwt}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 1 — la cifra es la de SU categoría, y la cuota la del §2
  // ═══════════════════════════════════════════════════════════════════════════

  it('BARRERA 1 — cuenta los vigentes de SU categoría y aplica la aritmética del diseño', async () => {
    // Once destacados vigentes en «coches». Con el que pregunta serían doce: tres grupos, ocho
    // horas al día — la fila de la tabla del §2.
    for (let i = 0; i < 11; i++) {
      const otro = await crearAnuncio({ categoryId: coches });
      await destacar(otro.id, 'vigente');
    }
    // Ruido que NO debe contar: otra categoría.
    for (let i = 0; i < 5; i++) {
      const ajeno = await crearAnuncio({ categoryId: otraCategoria });
      await destacar(ajeno.id, 'vigente');
    }

    const mio = await crearAnuncio({ categoryId: coches });
    const res = await competencia(mio.id).expect(200);

    expect(res.body.vigentes).toBe(11);
    expect(res.body.categoria.slug).toBe('r4-coches');
    expect(res.body.cuota.candidatos).toBe(12); // los once + el que pregunta
    expect(res.body.cuota.grupos).toBe(3);
    expect(res.body.cuota.siempre).toBe(false);
    expect(Math.round(res.body.cuota.minutosDeVitrinaAlDia)).toBe(480); // 8 h
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 3 — la vigencia, con el mismo criterio que la rotación
  // ═══════════════════════════════════════════════════════════════════════════

  it('BARRERA 3 — caducados, revocados y anuncios no activos NO cuentan', async () => {
    const cat = await crearCategoria('r4-inmuebles');

    const vivo = await crearAnuncio({ categoryId: cat });
    await destacar(vivo.id, 'vigente');
    const sinCaducidad = await crearAnuncio({ categoryId: cat });
    await destacar(sinCaducidad.id, 'permanente'); // sin fecha de fin: SÍ cuenta

    const caducado = await crearAnuncio({ categoryId: cat });
    await destacar(caducado.id, 'caducado');
    const revocado = await crearAnuncio({ categoryId: cat });
    await destacar(revocado.id, 'revocado');
    const borrador = await crearAnuncio({ categoryId: cat, status: ListingStatus.DRAFT });
    await destacar(borrador.id, 'vigente'); // destacado, pero el anuncio no está en la lista

    const mio = await crearAnuncio({ categoryId: cat });
    const res = await competencia(mio.id).expect(200);

    // Sólo el vigente y el permanente. Contar los otros tres le pintaría una categoría más
    // competida de lo que está.
    expect(res.body.vigentes).toBe(2);
    expect(res.body.cuota.candidatos).toBe(3);
    expect(res.body.cuota.siempre).toBe(true); // tres caben en el bloque de cuatro
  }, 60_000);

  it('el propio anuncio no se cuenta dos veces si YA estuviera destacado', async () => {
    const cat = await crearCategoria('r4-empleo');
    const otro = await crearAnuncio({ categoryId: cat });
    await destacar(otro.id, 'vigente');

    const mio = await crearAnuncio({ categoryId: cat });
    await destacar(mio.id, 'vigente'); // ya destacado

    const res = await competencia(mio.id).expect(200);

    expect(res.body.vigentes).toBe(1); // el otro, no él mismo
    expect(res.body.cuota.candidatos).toBe(2);
  }, 60_000);

  it('EL CASO BUENO: una categoría tranquila dice «siempre», y es verdad', async () => {
    const cat = await crearCategoria('r4-servicios');
    const mio = await crearAnuncio({ categoryId: cat });

    const res = await competencia(mio.id).expect(200);

    expect(res.body.vigentes).toBe(0);
    expect(res.body.cuota.siempre).toBe(true);
    expect(res.body.cuota.minutosDeVitrinaAlDia).toBe(1440); // las 24 h
  }, 60_000);

  it('EL UMBRAL, que es donde la cuenta ingenua se equivocaría', async () => {
    // Con CUATRO vigentes, contar sin incluir al que pregunta diría «caben todos, saldrás
    // siempre». Y es falso: en cuanto pague serían cinco y saldría media jornada.
    const cat = await crearCategoria('r4-moda');
    for (let i = 0; i < 4; i++) {
      const otro = await crearAnuncio({ categoryId: cat });
      await destacar(otro.id, 'vigente');
    }

    const mio = await crearAnuncio({ categoryId: cat });
    const res = await competencia(mio.id).expect(200);

    expect(res.body.vigentes).toBe(4);
    expect(res.body.cuota.siempre).toBe(false); // NO «siempre»
    expect(res.body.cuota.minutosDeVitrinaAlDia).toBe(720); // 12 h
  }, 60_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // El endpoint es un paso del flujo de compra: pide sesión y ser el dueño
  // ═══════════════════════════════════════════════════════════════════════════

  it('sin sesión, 401; sobre un anuncio ajeno, 403', async () => {
    const ajeno = await crearAnuncio({ categoryId: coches, sellerId: otroUserId });

    await request(app.getHttpServer())
      .get(`/api/billing/featured-competition/${ajeno.id}`)
      .expect(401);

    await competencia(ajeno.id).expect(403);
  }, 60_000);
});
