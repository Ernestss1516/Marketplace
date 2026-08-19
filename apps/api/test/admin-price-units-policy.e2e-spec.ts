/**
 * FORMATOS DE PRECIO — RP.2 (admin de categorías): escritura de
 * Category.allowedPriceUnits desde el admin + guard anti-huérfanos.
 *
 * RP.1 dejó el campo en el modelo y la validación 422 en anuncios, pero NINGÚN
 * DTO admin lo escribía. RP.2 abre esa puerta — y la abre con la red puesta:
 * restringir los formatos de una categoría con anuncios que ya usan un formato
 * excluido se rechaza con 400, nunca deja huérfanos.
 *
 * Mismo molde que admin-category-type-policy.e2e-spec.ts: no depende del orden
 * de arranque de FilterableAttributesResolver (estos endpoints leen Category
 * directamente vía Prisma), así que las categorías se crean dentro de cada test.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient, PriceUnit } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

describe('Admin — escritura de allowedPriceUnits y guard anti-huérfanos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let userToken: string;
  let moderatorToken: string;
  let sellerId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();

    const hash = (pw: string) => bcrypt.hash(pw, 4);
    const [, user, moderator] = await Promise.all([
      prisma.user.upsert({
        where: { email: 'apu-admin@example.com' },
        create: {
          email: 'apu-admin@example.com', name: 'APU Admin', slug: 'apu-admin',
          passwordHash: await hash('Test1234!'), emailVerified: true, role: 'ADMIN',
        },
        update: { role: 'ADMIN' },
      }),
      prisma.user.upsert({
        where: { email: 'apu-user@example.com' },
        create: {
          email: 'apu-user@example.com', name: 'APU User', slug: 'apu-user',
          passwordHash: await hash('Test1234!'), emailVerified: true,
        },
        update: {},
      }),
      prisma.user.upsert({
        where: { email: 'apu-moderator@example.com' },
        create: {
          email: 'apu-moderator@example.com', name: 'APU Moderator', slug: 'apu-moderator',
          passwordHash: await hash('Test1234!'), emailVerified: true, role: 'MODERATOR',
        },
        update: { role: 'MODERATOR' },
      }),
    ]);
    sellerId = user.id;
    void moderator;

    const [adminRes, userRes, moderatorRes] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/admin-login').send({ email: 'apu-admin@example.com', password: 'Test1234!' }),
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'apu-user@example.com', password: 'Test1234!' }),
      // MODERATOR entra por /auth/login, no por /auth/admin-login: esa puerta es
      // solo para ADMIN (403 + ADMIN_LOGIN_NOT_ADMIN) y no emitiría token, con
      // lo que el 403 de abajo sería en realidad un 401 por token vacío — el
      // contraste dejaría de probar lo que dice probar.
      request(app.getHttpServer()).post('/api/auth/login').send({ email: 'apu-moderator@example.com', password: 'Test1234!' }),
    ]);
    adminToken = adminRes.body.accessToken as string;
    userToken = userRes.body.accessToken as string;
    moderatorToken = moderatorRes.body.accessToken as string;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let seq = 0;
  function uniqueSlug(prefix: string) {
    seq += 1;
    return `${prefix}-${Date.now()}-${seq}`;
  }

  function createCategory(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  function updateCategory(id: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/api/admin/categories/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  /** Anuncio creado directo en BD: el guard mira `priceUnit` ya persistido,
   *  no cómo llegó a estarlo — y así se puede sembrar un formato que la
   *  categoría admitía ANTES del cambio que el test va a intentar. */
  async function createListingDirect(categoryId: string, priceUnit: PriceUnit) {
    return prisma.listing.create({
      data: {
        title: `Anuncio ${priceUnit} ${uniqueSlug('t')}`,
        slug: uniqueSlug('anuncio'),
        description: 'Descripción de prueba',
        price: 10,
        type: 'SERVICE',
        priceType: 'FIXED',
        priceUnit,
        categoryId,
        sellerId,
      },
    });
  }

  // ── Escritura básica ─────────────────────────────────────────────────────

  it('crear una categoría con allowedPriceUnits → 200 y se persiste', async () => {
    const res = await createCategory({
      name: 'APU Crear', slug: uniqueSlug('apu-crear'), order: 950,
      allowedPriceUnits: ['PER_MONTH', 'PER_HOUR'],
    }).expect(201);

    const saved = await prisma.category.findUnique({ where: { id: res.body.id } });
    expect(saved?.allowedPriceUnits).toEqual(['PER_MONTH', 'PER_HOUR']);
  });

  it('crear sin allowedPriceUnits → [] (no configurado), compatibilidad intacta', async () => {
    const res = await createCategory({
      name: 'APU Sin Formatos', slug: uniqueSlug('apu-sin'), order: 951,
    }).expect(201);

    const saved = await prisma.category.findUnique({ where: { id: res.body.id } });
    expect(saved?.allowedPriceUnits).toEqual([]);
  });

  it('editar allowedPriceUnits de una categoría sin anuncios → 200 y se persiste', async () => {
    const cat = await prisma.category.create({
      data: { name: 'APU Editar', slug: uniqueSlug('apu-editar'), order: 952 },
    });

    await updateCategory(cat.id, { allowedPriceUnits: ['PER_DAY'] }).expect(200);

    const saved = await prisma.category.findUnique({ where: { id: cat.id } });
    expect(saved?.allowedPriceUnits).toEqual(['PER_DAY']);
  });

  it('un formato fuera del enum → 400 del DTO', async () => {
    await createCategory({
      name: 'APU Inventado', slug: uniqueSlug('apu-inventado'), order: 953,
      allowedPriceUnits: ['PER_FORTNIGHT'],
    }).expect(400);
  });

  it('el árbol admin devuelve allowedPriceUnits CRUDO (lo propio, no lo heredado)', async () => {
    const parent = await prisma.category.create({
      data: {
        name: 'APU Árbol Padre', slug: uniqueSlug('apu-arbol-padre'), order: 954,
        allowedPriceUnits: ['PER_MONTH'],
      },
    });
    const child = await prisma.category.create({
      data: { name: 'APU Árbol Hija', slug: uniqueSlug('apu-arbol-hija'), order: 1, parentId: parent.id },
    });

    const res = await request(app.getHttpServer())
      .get('/api/admin/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const parentNode = res.body.find((c: { id: string }) => c.id === parent.id);
    expect(parentNode.allowedPriceUnits).toEqual(['PER_MONTH']);

    // La hija NO configura nada propio: el árbol admin devuelve [] (crudo), NO
    // el efectivo ['PER_MONTH'] — el admin edita lo propio, no lo heredado.
    const childNode = parentNode.children.find((c: { id: string }) => c.id === child.id);
    expect(childNode.allowedPriceUnits).toEqual([]);
  });

  // ── Permisos ─────────────────────────────────────────────────────────────

  describe('permisos', () => {
    let catId: string;

    beforeAll(async () => {
      const cat = await prisma.category.create({
        data: { name: 'APU Permisos', slug: uniqueSlug('apu-permisos'), order: 955 },
      });
      catId = cat.id;
    });

    // Sanity-check del contraste: si el adminToken NO diera 200 en esta misma
    // ruta, los 401/403 de abajo no probarían nada (podrían venir de un token
    // roto o de una ruta inexistente). Se ancla primero el camino bueno.
    it('ADMIN sí puede (ancla del contraste) → 200', async () => {
      await updateCategory(catId, { allowedPriceUnits: ['PER_HOUR'] }).expect(200);
    });

    it('sin autenticación → 401', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/categories/${catId}`)
        .send({ allowedPriceUnits: ['PER_DAY'] })
        .expect(401);
    });

    it('USER → 403', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/categories/${catId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ allowedPriceUnits: ['PER_DAY'] })
        .expect(403);
    });

    // ROLES R2 — este caso decía «MODERATOR → 403 (gestionar categorías es solo
    // de ADMIN)». Ya no: el catálogo baja a MODERATOR con la sección
    // `/admin/categorias`. Se conserva el contraste invirtiéndolo — el moderador
    // SÍ puede, y el suelo (sin auth, USER) sigue donde estaba.
    it('MODERATOR → 200 (el catálogo es trabajo de moderación desde R2)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/categories/${catId}`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ allowedPriceUnits: ['PER_HOUR'] })
        .expect(200);
    });

    it('ninguno de los intentos rechazados cambió nada', async () => {
      // Los rechazados son «sin auth» y «USER». El PATCH del MODERATOR de arriba
      // reescribe el mismo valor a propósito (PER_HOUR), para que este invariante
      // siga midiendo lo que medía: que un 403 no escribe.
      const saved = await prisma.category.findUnique({ where: { id: catId } });
      expect(saved?.allowedPriceUnits).toEqual(['PER_HOUR']);
    });
  });

  // ── GUARD ANTI-HUÉRFANOS (el test clave de RP.2) ─────────────────────────

  describe('guard anti-huérfanos', () => {
    it('restringir a un conjunto que deja fuera anuncios existentes → 400 con el recuento', async () => {
      const cat = await prisma.category.create({
        data: {
          name: 'APU Huérfanos', slug: uniqueSlug('apu-huerfanos'), order: 960,
          allowedPriceUnits: ['ONE_TIME', 'PER_HOUR'],
        },
      });
      await createListingDirect(cat.id, 'PER_HOUR');
      await createListingDirect(cat.id, 'PER_HOUR');

      const res = await updateCategory(cat.id, { allowedPriceUnits: ['ONE_TIME'] }).expect(400);
      expect(res.body.message).toContain('2');
      expect(res.body.message).toMatch(/formato/i);
    });

    it('y NADA se persiste: la categoría conserva los formatos que ya tenía', async () => {
      const cat = await prisma.category.create({
        data: {
          name: 'APU Huérfanos NoEscribe', slug: uniqueSlug('apu-huerfanos-ne'), order: 961,
          allowedPriceUnits: ['ONE_TIME', 'PER_HOUR'],
        },
      });
      await createListingDirect(cat.id, 'PER_HOUR');

      await updateCategory(cat.id, { allowedPriceUnits: ['ONE_TIME'] }).expect(400);

      const saved = await prisma.category.findUnique({ where: { id: cat.id } });
      expect(saved?.allowedPriceUnits).toEqual(['ONE_TIME', 'PER_HOUR']);
    });

    it('el anuncio sigue siendo válido: su categoría sigue permitiendo su formato', async () => {
      const cat = await prisma.category.create({
        data: {
          name: 'APU Huérfanos Sigue', slug: uniqueSlug('apu-huerfanos-s'), order: 962,
          allowedPriceUnits: ['ONE_TIME', 'PER_HOUR'],
        },
      });
      const listing = await createListingDirect(cat.id, 'PER_HOUR');

      await updateCategory(cat.id, { allowedPriceUnits: ['ONE_TIME'] }).expect(400);

      const saved = await prisma.category.findUnique({ where: { id: cat.id } });
      const savedListing = await prisma.listing.findUnique({ where: { id: listing.id } });
      expect(saved?.allowedPriceUnits).toContain(savedListing!.priceUnit);
    });

    it('restringir a un conjunto que SÍ cubre los anuncios existentes → 200', async () => {
      const cat = await prisma.category.create({
        data: {
          name: 'APU Cubre', slug: uniqueSlug('apu-cubre'), order: 963,
          allowedPriceUnits: ['ONE_TIME', 'PER_HOUR', 'PER_DAY'],
        },
      });
      await createListingDirect(cat.id, 'PER_HOUR');

      await updateCategory(cat.id, { allowedPriceUnits: ['PER_HOUR'] }).expect(200);

      const saved = await prisma.category.findUnique({ where: { id: cat.id } });
      expect(saved?.allowedPriceUnits).toEqual(['PER_HOUR']);
    });

    it('volver a [] (no configurado) SIEMPRE pasa, aunque haya anuncios: amplía, no restringe', async () => {
      const cat = await prisma.category.create({
        data: {
          name: 'APU Vaciar', slug: uniqueSlug('apu-vaciar'), order: 964,
          allowedPriceUnits: ['PER_HOUR'],
        },
      });
      await createListingDirect(cat.id, 'PER_HOUR');

      await updateCategory(cat.id, { allowedPriceUnits: [] }).expect(200);

      const saved = await prisma.category.findUnique({ where: { id: cat.id } });
      expect(saved?.allowedPriceUnits).toEqual([]);
    });

    it('reenviar el MISMO conjunto (reordenado) no dispara el guard → 200', async () => {
      const cat = await prisma.category.create({
        data: {
          name: 'APU Mismo', slug: uniqueSlug('apu-mismo'), order: 965,
          allowedPriceUnits: ['ONE_TIME', 'PER_HOUR'],
        },
      });
      // Un anuncio con un formato que NO está en la lista (sembrado directo,
      // como si la política hubiera cambiado antes de existir el guard). Si el
      // guard se disparara sin haber cambio real, esto daría 400.
      await createListingDirect(cat.id, 'PER_DAY');

      await updateCategory(cat.id, { allowedPriceUnits: ['PER_HOUR', 'ONE_TIME'] }).expect(200);
    });

    it('editar solo el nombre, sin tocar los formatos, nunca dispara el guard → 200', async () => {
      const cat = await prisma.category.create({
        data: {
          name: 'APU Solo Nombre', slug: uniqueSlug('apu-solo-nombre'), order: 966,
          allowedPriceUnits: ['ONE_TIME'],
        },
      });
      await createListingDirect(cat.id, 'PER_DAY');

      await updateCategory(cat.id, { name: 'APU Solo Nombre Renombrada' }).expect(200);
    });
  });

  // ── Herencia dentro del guard ────────────────────────────────────────────

  describe('herencia en el guard', () => {
    it('hija SIN config propia: sus anuncios cuentan en el cambio del padre → 400', async () => {
      const parent = await prisma.category.create({
        data: {
          name: 'APU Padre H1', slug: uniqueSlug('apu-padre-h1'), order: 970,
          allowedPriceUnits: ['ONE_TIME', 'PER_HOUR'],
        },
      });
      const child = await prisma.category.create({
        data: { name: 'APU Hija Hereda', slug: uniqueSlug('apu-hija-hereda'), order: 1, parentId: parent.id },
      });
      // El anuncio vive en la HIJA, que hereda del padre. Restringir el padre
      // dejaría a este anuncio sin formato válido.
      await createListingDirect(child.id, 'PER_HOUR');

      const res = await updateCategory(parent.id, { allowedPriceUnits: ['ONE_TIME'] }).expect(400);
      expect(res.body.message).toContain('1');
    });

    it('hija CON config propia: es inmune, el mismo cambio en el padre → 200', async () => {
      const parent = await prisma.category.create({
        data: {
          name: 'APU Padre H2', slug: uniqueSlug('apu-padre-h2'), order: 971,
          allowedPriceUnits: ['ONE_TIME', 'PER_HOUR'],
        },
      });
      const child = await prisma.category.create({
        data: {
          name: 'APU Hija Propia', slug: uniqueSlug('apu-hija-propia'), order: 1,
          parentId: parent.id, allowedPriceUnits: ['PER_HOUR'],
        },
      });
      // Mismo anuncio, misma situación que el test anterior — pero la hija
      // configura lo suyo, así que el override la aísla del cambio del padre.
      await createListingDirect(child.id, 'PER_HOUR');

      await updateCategory(parent.id, { allowedPriceUnits: ['ONE_TIME'] }).expect(200);

      const savedChild = await prisma.category.findUnique({ where: { id: child.id } });
      expect(savedChild?.allowedPriceUnits).toEqual(['PER_HOUR']);
    });
  });

  // ── SIN guard de coherencia con el padre (override legítimo) ─────────────

  describe('override legítimo: no hay guarda de coherencia con el padre', () => {
    it('crear una hija con un formato que el padre NO permite → 201, no 400 (Inmobiliaria → Alquiler)', async () => {
      const parent = await prisma.category.create({
        data: {
          name: 'APU Inmobiliaria', slug: uniqueSlug('apu-inmobiliaria'), order: 980,
          allowedPriceUnits: ['ONE_TIME'],
        },
      });

      const res = await createCategory({
        name: 'APU Alquiler', slug: uniqueSlug('apu-alquiler'), order: 1,
        parentId: parent.id, allowedPriceUnits: ['PER_MONTH'],
      }).expect(201);

      const saved = await prisma.category.findUnique({ where: { id: res.body.id } });
      expect(saved?.allowedPriceUnits).toEqual(['PER_MONTH']);
    });

    it('editar una hija a un formato que el padre NO permite → 200, no 400', async () => {
      const parent = await prisma.category.create({
        data: {
          name: 'APU Padre Venta', slug: uniqueSlug('apu-padre-venta'), order: 981,
          allowedPriceUnits: ['ONE_TIME'],
        },
      });
      const child = await prisma.category.create({
        data: { name: 'APU Hija Override', slug: uniqueSlug('apu-hija-override'), order: 1, parentId: parent.id },
      });

      await updateCategory(child.id, { allowedPriceUnits: ['PER_MONTH'] }).expect(200);

      const saved = await prisma.category.findUnique({ where: { id: child.id } });
      expect(saved?.allowedPriceUnits).toEqual(['PER_MONTH']);
    });
  });

  // ── No interferencia con las políticas ya existentes ─────────────────────

  it('allowedPriceUnits no interfiere con allowedListingType ni con allowedViews', async () => {
    const res = await createCategory({
      name: 'APU Combinada', slug: uniqueSlug('apu-combinada'), order: 990,
      allowedListingType: 'SERVICE_ONLY',
      allowedViews: ['LISTA', 'MAPA'],
      defaultView: 'MAPA',
      allowedPriceUnits: ['PER_HOUR'],
    }).expect(201);

    const saved = await prisma.category.findUnique({ where: { id: res.body.id } });
    expect(saved?.allowedListingType).toBe('SERVICE_ONLY');
    expect(saved?.allowedViews).toEqual(['LISTA', 'MAPA']);
    expect(saved?.defaultView).toBe('MAPA');
    expect(saved?.allowedPriceUnits).toEqual(['PER_HOUR']);
  });
});
