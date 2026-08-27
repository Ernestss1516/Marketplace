/**
 * PUERTA — REGLA NUEVA #2: CORREO VERIFICADO PARA PUBLICAR.
 *
 * La regla no rechaza: DEGRADA. Y lo que se prueba aquí es exactamente esa
 * diferencia, que es donde está todo el valor de la decisión:
 *
 *   · Un rechazo daría un 4xx y el vendedor no sabría dónde ha quedado su
 *     trabajo.
 *   · La degradación devuelve 200, el anuncio SIGUE EN DRAFT tal y como estaba
 *     —ni `publishedAt` escrito, ni `expiresAt`, ni un campo tocado— y viaja un
 *     aviso con la salida.
 *
 * Y las dos mitades que hacen que eso sea seguro: sólo ocurre al PUBLICAR (crear
 * y editar siguen libres) y sólo cuando ESE es el único problema (si además hay
 * otro, el rechazo se propaga entero para que se vean los dos).
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { preservarAjustes } from './helpers/settings';
import {
  EMAIL_NOT_VERIFIED_CODE,
  EMAIL_VERIFIED_RULE_ENABLED_SETTING,
} from 'src/modules/listing-gate/rules/email-verified.rule';

/**
 * El tope de activos que usa el último caso. Se fija y se restaura, porque es un
 * ajuste GLOBAL que otras suites tocan (ver la nota dentro del caso).
 */
const LIMITE_ACTIVOS = 'freeActiveListingLimit';
const TOPE_ACTIVOS = 2;

describe('Puerta — regla #2: correo verificado para publicar (e2e)', () => {
  // Esta suite es la que lleva escrita la historia del mordisco de H9 (ver la nota
  // larga dentro del último caso). Su `afterEach` repone el tope a 5 entre casos —
  // aislamiento interno, correcto— pero ese 5 es un literal: describe lo que siembra
  // la semilla HOY. `preservarAjustes` restaura la fila que había de verdad, que es lo
  // único que sigue siendo cierto si la semilla cambia.
  preservarAjustes([LIMITE_ACTIVOS]);

  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;

  /** Sin verificar: es el protagonista de casi todos los casos. */
  let sinVerificarId: string;
  let sinVerificarToken: string;
  /** Verificado: el control que demuestra que la condición es el correo. */
  let verificadoId: string;
  let verificadoToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = cat.id;

    const passwordHash = await bcrypt.hash('Test1234!', 4);
    const sin = await prisma.user.create({
      data: { email: 'sin-verificar@example.com', name: 'Sin Verificar', slug: 'sin-verificar', passwordHash, emailVerified: false },
    });
    sinVerificarId = sin.id;
    const con = await prisma.user.create({
      data: { email: 'con-verificar@example.com', name: 'Con Verificar', slug: 'con-verificar', passwordHash, emailVerified: true },
    });
    verificadoId = con.id;

    const [a, b] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'sin-verificar@example.com', password: 'Test1234!' }),
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'con-verificar@example.com', password: 'Test1234!' }),
    ]);
    sinVerificarToken = a.body.accessToken as string;
    verificadoToken = b.body.accessToken as string;
  });

  afterEach(async () => {
    await prisma.setting.deleteMany({ where: { key: EMAIL_VERIFIED_RULE_ENABLED_SETTING } });
    // El tope vuelve al 5 que siembra el seed — se RESTAURA en vez de borrarse,
    // para dejar la fila como estaba y no cambiarle el terreno a nadie.
    await prisma.setting.upsert({
      where: { key: LIMITE_ACTIVOS },
      create: { key: LIMITE_ACTIVOS, value: 5 },
      update: { value: 5 },
    });
    await prisma.listing.deleteMany({ where: { sellerId: { in: [sinVerificarId, verificadoId] } } });
    // El correo vuelve a su estado de partida: un caso lo verifica a mitad.
    await prisma.user.update({ where: { id: sinVerificarId }, data: { emailVerified: false } });
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
      where: { key: EMAIL_VERIFIED_RULE_ENABLED_SETTING },
      create: { key: EMAIL_VERIFIED_RULE_ENABLED_SETTING, value: true },
      update: { value: true },
    });
  }

  let n = 0;
  async function seedDraft(sellerId: string): Promise<{ id: string; slug: string }> {
    n += 1;
    return prisma.listing.create({
      data: {
        title: `Correo verificado ${n}`,
        slug: `correo-verificado-${n}-${Date.now()}`,
        description: 'Anuncio de la suite de correo verificado',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.DRAFT,
        sellerId,
        categoryId,
      },
      select: { id: true, slug: true },
    });
  }

  function publicar(id: string, token: string) {
    return request(app.getHttpServer())
      .post(`/api/listings/${id}/publish`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function fila(id: string) {
    return prisma.listing.findUniqueOrThrow({
      where: { id },
      select: { status: true, publishedAt: true, expiresAt: true },
    });
  }

  // ===========================================================================
  // 1 · APAGADA (como nace)
  // ===========================================================================

  it('APAGADA: un vendedor sin verificar publica como siempre', async () => {
    const l = await seedDraft(sinVerificarId);

    const res = await publicar(l.id, sinVerificarToken).expect(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.publishBlocked).toBeUndefined();
    expect((await fila(l.id)).status).toBe(ListingStatus.ACTIVE);
  });

  // ===========================================================================
  // 2 · ENCENDIDA — la degradación
  // ===========================================================================

  describe('ENCENDIDA', () => {
    it('sin verificar: 200, se queda en DRAFT y avisa — NO es un error', async () => {
      const l = await seedDraft(sinVerificarId);
      await encenderRegla();

      // 200, no 4xx: no ha fallado nada. El anuncio está guardado y a salvo.
      const res = await publicar(l.id, sinVerificarToken).expect(200);

      expect(res.body.status).toBe('DRAFT');
      expect(res.body.publishBlocked.code).toBe(EMAIL_NOT_VERIFIED_CODE);
      // El aviso lleva a la solución, no sólo anuncia el problema.
      expect(res.body.publishBlocked.message).toMatch(/verifica tu correo/i);
      expect(res.body.publishBlocked.message).toMatch(/borrador/i);
    });

    it('NO TOCA NADA: ni publishedAt, ni expiresAt, ni el estado', async () => {
      const l = await seedDraft(sinVerificarId);
      const antes = await fila(l.id);
      await encenderRegla();

      await publicar(l.id, sinVerificarToken).expect(200);

      // La publicación no se revierte: no llega a ocurrir. Sin rastro de un
      // intento a medias que alguien tenga que limpiar después.
      expect(await fila(l.id)).toEqual(antes);
      expect(antes.publishedAt).toBeNull();
      expect(antes.expiresAt).toBeNull();
    });

    it('CON el correo verificado: publica con total normalidad', async () => {
      // El control que demuestra que la condición es el correo y no un bloqueo
      // general: misma regla encendida, mismo camino, resultado opuesto.
      const l = await seedDraft(verificadoId);
      await encenderRegla();

      const res = await publicar(l.id, verificadoToken).expect(200);
      expect(res.body.status).toBe('ACTIVE');
      expect((await fila(l.id)).status).toBe(ListingStatus.ACTIVE);
    });

    it('tras VERIFICAR, el mismo borrador se publica sin más', async () => {
      const l = await seedDraft(sinVerificarId);
      await encenderRegla();

      await publicar(l.id, sinVerificarToken).expect(200);
      expect((await fila(l.id)).status).toBe(ListingStatus.DRAFT);

      // El vendedor verifica su correo…
      await prisma.user.update({ where: { id: sinVerificarId }, data: { emailVerified: true } });

      // …y el MISMO anuncio, sin tocarlo, ya se publica. La degradación se
      // deshace sola: no hay ningún estado intermedio que limpiar.
      const res = await publicar(l.id, sinVerificarToken).expect(200);
      expect(res.body.status).toBe('ACTIVE');
    });
  });

  // ===========================================================================
  // 3 · LO QUE SIGUE SIENDO LIBRE
  // ===========================================================================

  describe('Crear y redactar siguen libres', () => {
    it('un vendedor sin verificar CREA y EDITA su anuncio con la regla encendida', async () => {
      await encenderRegla();

      // Crear: permitido. El trabajo se hace igual.
      const creado = await request(app.getHttpServer())
        .post('/api/listings')
        .set('Authorization', `Bearer ${sinVerificarToken}`)
        .send({
          title: 'Redactado sin verificar',
          description: 'Se puede escribir entero',
          price: 10,
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          categoryId,
          city: 'Madrid',
          province: 'Madrid',
          latitude: 40.4168,
          longitude: -3.7038,
        })
        .expect(201);

      // Editar: permitido.
      await request(app.getHttpServer())
        .patch(`/api/listings/${creado.body.id}`)
        .set('Authorization', `Bearer ${sinVerificarToken}`)
        .send({ title: 'Y se puede seguir corrigiendo' })
        .expect(200);

      // Sólo el paso al mercado se frena.
      const res = await publicar(creado.body.id as string, sinVerificarToken).expect(200);
      expect(res.body.status).toBe('DRAFT');
    });
  });

  // ===========================================================================
  // 4 · CUANDO NO ES EL ÚNICO PROBLEMA
  // ===========================================================================

  it('si además está en el tope de activos, el rechazo se propaga ENTERO', async () => {
    // Dos problemas a la vez. Degradar en silencio le escondería el segundo: el
    // vendedor verificaría el correo y volvería a chocar contra la cuota.
    //
    // EL TOPE SE FIJA AQUÍ, no se da por supuesto. Antes este caso creaba cinco
    // activos confiando en que `freeActiveListingLimit` valiera 5, que es lo que
    // siembra el seed; pero CUATRO suites más lo suben a 500 para poder publicar
    // sin topar y lo restauran en su `afterAll`. Si alguna no llega a restaurarlo
    // —o si el orden de Jest cambia al añadir una suite nueva—, la cuota no salta
    // y este caso falla con un «200 en vez de 403» que no tiene nada que ver con
    // lo que prueba. Se vio ocurrir una vez y no volver a reproducirse: fijar el
    // valor es más barato que volver a investigarlo.
    await prisma.setting.upsert({
      where: { key: LIMITE_ACTIVOS },
      create: { key: LIMITE_ACTIVOS, value: TOPE_ACTIVOS },
      update: { value: TOPE_ACTIVOS },
    });

    for (let i = 0; i < TOPE_ACTIVOS; i++) {
      await prisma.listing.create({
        data: {
          title: `Activo ${i}`,
          slug: `activo-tope-${i}-${Date.now()}`,
          description: 'ocupa plaza',
          price: new Prisma.Decimal('10.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status: ListingStatus.ACTIVE,
          sellerId: sinVerificarId,
          categoryId,
          publishedAt: new Date(),
          expiresAt: new Date(Date.now() + 60 * 86_400_000),
        },
      });
    }
    const l = await seedDraft(sinVerificarId);
    await encenderRegla();

    const res = await publicar(l.id, sinVerificarToken).expect(403);

    // Los DOS motivos, no uno.
    const codes = (res.body.reasons as Array<{ code: string }>).map((r) => r.code).sort();
    expect(codes).toEqual(['ACTIVE_LIMIT_REACHED', EMAIL_NOT_VERIFIED_CODE].sort());
    expect((await fila(l.id)).status).toBe(ListingStatus.DRAFT);
  });
});
