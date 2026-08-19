/**
 * FICHA F2 (P6) — LOS FILTROS CON LOS QUE EL BACKOFFICE ENCUENTRA CUALQUIER ANUNCIO.
 *
 * LA BARRERA DE ESTA RÁFAGA: filtrar por la categoría **ABUELA** devuelve el
 * anuncio de la **NIETA**. Los anuncios cuelgan de las hojas, así que un filtro
 * exacto por una categoría intermedia devuelve cero y parece —al moderador— que
 * esa rama del catálogo está vacía. Es el riesgo R1 de la profundidad N, que este
 * repositorio ya se comió una vez.
 *
 * Y LA OTRA MITAD: el backoffice encuentra los ocho estados NO públicos. Es la
 * prueba de que esto va a Postgres y no a Meilisearch — Meili indexa **sólo
 * ACTIVE**, así que un `/busqueda` mejorado nunca podría hacer este trabajo.
 *
 * Ver docs/diseno-ficha-anuncio.md §2 y §3.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Ficha F2 — filtros y ordenación del backoffice (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let moderatorToken: string;
  let editorToken: string;
  let sellerAId: string;
  let sellerBId: string;
  let reporterId: string;

  /** Abuela › Madre › Nieta — tres niveles, que es lo que la barrera necesita. */
  let abuelaId: string;
  let madreId: string;
  let nietaId: string;
  /** Una rama aparte, para comprobar que el filtro ACOTA además de incluir. */
  let otraRamaId: string;

  const server = () => app.getHttpServer();

  async function crearAnuncio(opts: {
    titulo: string;
    descripcion?: string;
    status?: string;
    sellerId?: string;
    categoryId?: string;
    price?: number;
    needsRevalidation?: boolean;
    createdAt?: Date;
  }) {
    return prisma.listing.create({
      data: {
        title: opts.titulo,
        slug: `f2-${opts.titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 8)}`,
        description: opts.descripcion ?? 'Descripción genérica de prueba.',
        price: opts.price ?? 100,
        type: 'PRODUCT',
        status: (opts.status ?? 'ACTIVE') as never,
        sellerId: opts.sellerId ?? sellerAId,
        categoryId: opts.categoryId ?? nietaId,
        needsRevalidation: opts.needsRevalidation ?? false,
        ...(opts.createdAt && { createdAt: opts.createdAt }),
      },
    });
  }

  /** Pide la lista y devuelve los títulos, que es lo que se afirma. */
  async function listar(qs: string, token = moderatorToken) {
    const res = await request(server())
      .get(`/api/admin/listings?${qs}`)
      .set('Authorization', `Bearer ${token}`);
    return {
      status: res.status,
      total: res.body.total as number,
      titulos: (res.body.items ?? []).map((i: { title: string }) => i.title) as string[],
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [a, b, rep] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'f2-sellera@example.com', name: 'F2 Vendedor A', slug: 'f2-sellera',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'f2-sellerb@example.com', name: 'F2 Vendedor B', slug: 'f2-sellerb',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'f2-reporter@example.com', name: 'F2 Reporter', slug: 'f2-reporter',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'f2-mod@example.com', name: 'F2 Mod', slug: 'f2-mod',
          passwordHash, emailVerified: true, role: 'MODERATOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'f2-editor@example.com', name: 'F2 Editor', slug: 'f2-editor',
          passwordHash, emailVerified: true, role: 'EDITOR',
        },
      }),
    ]);
    sellerAId = a.id;
    sellerBId = b.id;
    reporterId = rep.id;

    const abuela = await prisma.category.create({
      data: { name: 'F2 Abuela', slug: 'f2-abuela', attributeSchema: [] },
    });
    abuelaId = abuela.id;
    const madre = await prisma.category.create({
      data: { name: 'F2 Madre', slug: 'f2-madre', parentId: abuela.id, attributeSchema: [] },
    });
    madreId = madre.id;
    const nieta = await prisma.category.create({
      data: { name: 'F2 Nieta', slug: 'f2-nieta', parentId: madre.id, attributeSchema: [] },
    });
    nietaId = nieta.id;
    const otra = await prisma.category.create({
      data: { name: 'F2 Otra', slug: 'f2-otra', attributeSchema: [] },
    });
    otraRamaId = otra.id;

    const login = (email: string) =>
      request(server()).post('/api/auth/admin-login').send({ email, password: 'Test1234!' });
    moderatorToken = (await login('f2-mod@example.com')).body.accessToken as string;
    editorToken = (await login('f2-editor@example.com')).body.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.report.deleteMany({});
    await prisma.listing.deleteMany({});
  });

  // ── LA BARRERA ────────────────────────────────────────────────────────────

  describe('LA BARRERA — la categoría incluye sus descendientes (profundidad N)', () => {
    it('filtrar por la ABUELA devuelve el anuncio de la NIETA', async () => {
      await crearAnuncio({ titulo: 'F2 En la nieta', categoryId: nietaId });

      const { titulos } = await listar(`categoryId=${abuelaId}`);

      expect(titulos).toContain('F2 En la nieta');
    });

    it('filtrar por la ABUELA devuelve los TRES niveles a la vez', async () => {
      await crearAnuncio({ titulo: 'F2 Nivel abuela', categoryId: abuelaId });
      await crearAnuncio({ titulo: 'F2 Nivel madre', categoryId: madreId });
      await crearAnuncio({ titulo: 'F2 Nivel nieta', categoryId: nietaId });

      const { titulos, total } = await listar(`categoryId=${abuelaId}`);

      expect(total).toBe(3);
      expect(titulos.sort()).toEqual(['F2 Nivel abuela', 'F2 Nivel madre', 'F2 Nivel nieta']);
    });

    it('filtrar por la MADRE excluye a la abuela e incluye a la nieta', async () => {
      // El filtro no es «todo el árbol»: baja, no sube. Sin esto, un filtro que
      // devolviera de más pasaría el primer test y seguiría siendo inútil.
      await crearAnuncio({ titulo: 'F2 Solo abuela', categoryId: abuelaId });
      await crearAnuncio({ titulo: 'F2 Solo madre', categoryId: madreId });
      await crearAnuncio({ titulo: 'F2 Solo nieta', categoryId: nietaId });

      const { titulos } = await listar(`categoryId=${madreId}`);

      expect(titulos.sort()).toEqual(['F2 Solo madre', 'F2 Solo nieta']);
    });

    it('ACOTA: una rama hermana no entra', async () => {
      await crearAnuncio({ titulo: 'F2 Rama propia', categoryId: nietaId });
      await crearAnuncio({ titulo: 'F2 Rama ajena', categoryId: otraRamaId });

      const { titulos } = await listar(`categoryId=${abuelaId}`);

      expect(titulos).toEqual(['F2 Rama propia']);
    });
  });

  // ── Postgres, no Meili ────────────────────────────────────────────────────

  describe('encuentra los estados NO públicos — la prueba de que va a Postgres', () => {
    it.each([['DRAFT'], ['PENDING_REVIEW'], ['REJECTED'], ['ARCHIVED'], ['PAUSED'], ['EXPIRED']])(
      'encuentra un %s por texto libre',
      async (status) => {
        // Meilisearch indexa SÓLO ACTIVE: ninguno de estos existe para
        // `/busqueda`. Que el backoffice los encuentre es la diferencia entera.
        await crearAnuncio({ titulo: `F2 Oculto ${status}`, status });

        const { titulos } = await listar(`q=${encodeURIComponent(`Oculto ${status}`)}`);

        expect(titulos).toEqual([`F2 Oculto ${status}`]);
      },
    );
  });

  // ── El texto libre ────────────────────────────────────────────────────────

  describe('texto libre — el hueco que no existía', () => {
    it('casa por TÍTULO, sin distinguir mayúsculas', async () => {
      await crearAnuncio({ titulo: 'F2 Bicicleta de montaña' });
      await crearAnuncio({ titulo: 'F2 Mesa de comedor' });

      const { titulos } = await listar('q=BICICLETA');

      expect(titulos).toEqual(['F2 Bicicleta de montaña']);
    });

    it('casa por DESCRIPCIÓN', async () => {
      await crearAnuncio({ titulo: 'F2 Sin pistas', descripcion: 'Incluye casco y candado.' });
      await crearAnuncio({ titulo: 'F2 Otro', descripcion: 'Nada que ver.' });

      const { titulos } = await listar('q=candado');

      expect(titulos).toEqual(['F2 Sin pistas']);
    });

    it('casa por SLUG pegado de una URL', async () => {
      const a = await crearAnuncio({ titulo: 'F2 Por slug' });

      const { titulos } = await listar(`q=${a.slug}`);

      expect(titulos).toEqual(['F2 Por slug']);
    });

    it('casa por ID exacto', async () => {
      const a = await crearAnuncio({ titulo: 'F2 Por id' });
      await crearAnuncio({ titulo: 'F2 Ruido' });

      const { titulos } = await listar(`q=${a.id}`);

      expect(titulos).toEqual(['F2 Por id']);
    });

    it('sin coincidencias devuelve lista vacía, no un error', async () => {
      await crearAnuncio({ titulo: 'F2 Algo' });

      const { status, total } = await listar('q=zzzznoexiste');

      expect(status).toBe(200);
      expect(total).toBe(0);
    });
  });

  // ── Los demás ejes del núcleo ─────────────────────────────────────────────

  describe('estado múltiple', () => {
    it('`statuses` admite varios a la vez', async () => {
      await crearAnuncio({ titulo: 'F2 Es borrador', status: 'DRAFT' });
      await crearAnuncio({ titulo: 'F2 Es pendiente', status: 'PENDING_REVIEW' });
      await crearAnuncio({ titulo: 'F2 Es activo', status: 'ACTIVE' });

      const { titulos } = await listar('statuses=DRAFT,PENDING_REVIEW');

      expect(titulos.sort()).toEqual(['F2 Es borrador', 'F2 Es pendiente']);
    });

    it('`status` a secas sigue funcionando EXACTAMENTE igual (la cola de M3)', async () => {
      // Compatibilidad, y no es teórica: `/admin/moderacion` llama a este mismo
      // endpoint con `status=PENDING_REVIEW&order=oldest`.
      await crearAnuncio({ titulo: 'F2 Cola uno', status: 'PENDING_REVIEW' });
      await crearAnuncio({ titulo: 'F2 No cola', status: 'ACTIVE' });

      const { titulos } = await listar('status=PENDING_REVIEW&order=oldest');

      expect(titulos).toEqual(['F2 Cola uno']);
    });

    it('un estado inventado da 400, no una lista silenciosamente vacía', async () => {
      // Un filtro que se traga lo que no entiende y devuelve cero es peor que un
      // error: el moderador lee «no hay nada» y se lo cree.
      const { status } = await listar('statuses=DRAFT,NOEXISTE');

      expect(status).toBe(400);
    });

    it('con los dos, gana `statuses` (el más específico)', async () => {
      await crearAnuncio({ titulo: 'F2 Gana borrador', status: 'DRAFT' });
      await crearAnuncio({ titulo: 'F2 Pierde activo', status: 'ACTIVE' });

      const { titulos } = await listar('status=ACTIVE&statuses=DRAFT');

      expect(titulos).toEqual(['F2 Gana borrador']);
    });
  });

  describe('vendedor, reportes y revalidación', () => {
    it('filtra por vendedor (el parámetro que estaba construido y sin usar)', async () => {
      await crearAnuncio({ titulo: 'F2 De A', sellerId: sellerAId });
      await crearAnuncio({ titulo: 'F2 De B', sellerId: sellerBId });

      const { titulos } = await listar(`sellerId=${sellerBId}`);

      expect(titulos).toEqual(['F2 De B']);
    });

    it('`hasReports=true` deja sólo los denunciados', async () => {
      const denunciado = await crearAnuncio({ titulo: 'F2 Denunciado' });
      await crearAnuncio({ titulo: 'F2 Limpio' });
      await prisma.report.create({
        data: { reason: 'SPAM', reporterId, listingId: denunciado.id, listingTitle: denunciado.title },
      });

      const { titulos } = await listar('hasReports=true');

      expect(titulos).toEqual(['F2 Denunciado']);
    });

    it('`hasReports=false` es la pregunta CONTRARIA, no «sin filtro»', async () => {
      const denunciado = await crearAnuncio({ titulo: 'F2 Con denuncia' });
      await crearAnuncio({ titulo: 'F2 Sin denuncia' });
      await prisma.report.create({
        data: { reason: 'SPAM', reporterId, listingId: denunciado.id, listingTitle: denunciado.title },
      });

      const { titulos } = await listar('hasReports=false');

      expect(titulos).toEqual(['F2 Sin denuncia']);
    });

    it('`needsRevalidation=true` deja sólo los marcados', async () => {
      await crearAnuncio({ titulo: 'F2 Marcado', needsRevalidation: true });
      await crearAnuncio({ titulo: 'F2 Conforme', needsRevalidation: false });

      const { titulos } = await listar('needsRevalidation=true');

      expect(titulos).toEqual(['F2 Marcado']);
    });
  });

  describe('rangos de fecha', () => {
    it('`createdFrom` deja fuera lo anterior', async () => {
      await crearAnuncio({ titulo: 'F2 Viejo', createdAt: new Date('2020-01-01') });
      await crearAnuncio({ titulo: 'F2 Nuevo', createdAt: new Date('2026-06-01') });

      const { titulos } = await listar('createdFrom=2026-01-01T00:00:00.000Z');

      expect(titulos).toEqual(['F2 Nuevo']);
    });

    it('`createdFrom` + `createdTo` acotan por los dos lados', async () => {
      await crearAnuncio({ titulo: 'F2 Antes', createdAt: new Date('2025-01-01') });
      await crearAnuncio({ titulo: 'F2 Dentro', createdAt: new Date('2026-03-01') });
      await crearAnuncio({ titulo: 'F2 Después', createdAt: new Date('2026-12-01') });

      const { titulos } = await listar(
        'createdFrom=2026-01-01T00:00:00.000Z&createdTo=2026-06-01T00:00:00.000Z',
      );

      expect(titulos).toEqual(['F2 Dentro']);
    });
  });

  // ── Combinables ───────────────────────────────────────────────────────────

  describe('los ejes se COMBINAN — que es de lo que sirve un buscador', () => {
    it('estado múltiple + vendedor + categoría, los tres a la vez', async () => {
      // El caso real: «los borradores y pendientes de este vendedor en esta rama».
      await crearAnuncio({ titulo: 'F2 Diana', status: 'DRAFT', sellerId: sellerBId, categoryId: nietaId });
      await crearAnuncio({ titulo: 'F2 Falla estado', status: 'ACTIVE', sellerId: sellerBId, categoryId: nietaId });
      await crearAnuncio({ titulo: 'F2 Falla vendedor', status: 'DRAFT', sellerId: sellerAId, categoryId: nietaId });
      await crearAnuncio({ titulo: 'F2 Falla rama', status: 'DRAFT', sellerId: sellerBId, categoryId: otraRamaId });

      const { titulos } = await listar(
        `statuses=DRAFT,PENDING_REVIEW&sellerId=${sellerBId}&categoryId=${abuelaId}`,
      );

      expect(titulos).toEqual(['F2 Diana']);
    });

    it('texto libre + estado, juntos', async () => {
      await crearAnuncio({ titulo: 'F2 Bici roja', status: 'DRAFT' });
      await crearAnuncio({ titulo: 'F2 Bici azul', status: 'ACTIVE' });

      const { titulos } = await listar('q=Bici&statuses=DRAFT');

      expect(titulos).toEqual(['F2 Bici roja']);
    });
  });

  // ── Orden y paginación ────────────────────────────────────────────────────

  describe('ordenación', () => {
    it('sin parámetro, lo último movido primero (el de siempre)', async () => {
      const viejo = await crearAnuncio({ titulo: 'F2 Movido antes' });
      await crearAnuncio({ titulo: 'F2 Movido después' });
      await prisma.listing.update({
        where: { id: viejo.id },
        data: { updatedAt: new Date('2020-01-01') },
      });

      const { titulos } = await listar('');

      expect(titulos[0]).toBe('F2 Movido después');
    });

    it('`price-asc` y `price-desc` ordenan por precio', async () => {
      await crearAnuncio({ titulo: 'F2 Caro', price: 900 });
      await crearAnuncio({ titulo: 'F2 Barato', price: 5 });

      expect((await listar('order=price-asc')).titulos).toEqual(['F2 Barato', 'F2 Caro']);
      expect((await listar('order=price-desc')).titulos).toEqual(['F2 Caro', 'F2 Barato']);
    });

    it('`reports-desc` pone lo más denunciado arriba', async () => {
      const mucho = await crearAnuncio({ titulo: 'F2 Muy denunciado' });
      const poco = await crearAnuncio({ titulo: 'F2 Poco denunciado' });
      await prisma.report.createMany({
        data: [
          { reason: 'SPAM', reporterId, listingId: mucho.id, listingTitle: mucho.title },
          { reason: 'FRAUD', reporterId, listingId: mucho.id, listingTitle: mucho.title },
          { reason: 'SPAM', reporterId, listingId: poco.id, listingTitle: poco.title },
        ],
      });

      const { titulos } = await listar('order=reports-desc');

      expect(titulos[0]).toBe('F2 Muy denunciado');
    });

    it('un orden desconocido da 400, no un orden silencioso', async () => {
      const { status } = await listar('order=inventado');

      expect(status).toBe(400);
    });
  });

  describe('paginación', () => {
    it('pagina y el total cuenta el conjunto FILTRADO, no la tabla entera', async () => {
      for (let i = 0; i < 5; i++) {
        await crearAnuncio({ titulo: `F2 Pag ${i}`, status: 'DRAFT' });
      }
      await crearAnuncio({ titulo: 'F2 Fuera del filtro', status: 'ACTIVE' });

      const p1 = await listar('statuses=DRAFT&perPage=2&page=1');
      const p2 = await listar('statuses=DRAFT&perPage=2&page=2');
      const p3 = await listar('statuses=DRAFT&perPage=2&page=3');

      expect(p1.total).toBe(5);
      expect(p1.titulos).toHaveLength(2);
      expect(p2.titulos).toHaveLength(2);
      expect(p3.titulos).toHaveLength(1);
      // Y ninguna página repite lo de la anterior.
      expect(new Set([...p1.titulos, ...p2.titulos, ...p3.titulos]).size).toBe(5);
    });
  });

  // ── Permisos ──────────────────────────────────────────────────────────────

  describe('permisos — la lista sigue siendo MODERATOR+', () => {
    it('un EDITOR recibe 403 aunque mande filtros', async () => {
      const { status } = await listar(`categoryId=${abuelaId}&q=lo-que-sea`, editorToken);

      expect(status).toBe(403);
    });
  });
});
