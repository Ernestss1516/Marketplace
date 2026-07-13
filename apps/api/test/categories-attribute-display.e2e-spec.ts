/**
 * BÚSQUEDA — RÁFAGA 3 (display de atributos en card): showLabel/showUnit en
 * el schema de atributos, resueltos por CategoriesService y expuestos vía
 * GET /categories (árbol → cardAttributes/wideCardAttributes) y
 * GET /categories/:slug (una categoría → wideCardAttributes).
 *
 * OJO: `attributeSchema` (tal cual se devuelve en GET /categories/:slug) es el
 * schema efectivo CRUDO — NO pasa por el resolver, exactamente igual que
 * `cardAttribute`/`wideCardAttribute` ya se comportaban antes de esta ráfaga
 * (ausentes ahí si no se configuraron). El default solo se aplica en las
 * listas YA RESUELTAS que consume la card: cardAttributes/wideCardAttributes
 * (backend, vía toAttrDef) y lo que construye el frontend a partir del
 * attributeSchema crudo (card-attributes.ts). Estos tests comprueban las
 * listas resueltas, que es lo que de verdad ve la card.
 *
 * El punto central: el DEFAULT reproduce la regla hardcodeada anterior a esta
 * ráfaga (oculta el label si hay unidad, muestra la unidad si la hay) para
 * que los atributos ya configurados (sin showLabel/showUnit en su JSON) no
 * cambien de aspecto.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

interface ResolvedAttr {
  key: string;
  label: string;
  unit?: string;
  showLabel: boolean;
  showUnit: boolean;
}

describe('Categorías — showLabel/showUnit en atributos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();

    const hash = (pw: string) => bcrypt.hash(pw, 4);
    await prisma.user.upsert({
      where: { email: 'cad-admin@example.com' },
      create: {
        email: 'cad-admin@example.com', name: 'CAD Admin', slug: 'cad-admin',
        passwordHash: await hash('Test1234!'), emailVerified: true, role: 'ADMIN',
      },
      update: {},
    });
    const adminRes = await request(app.getHttpServer())
      .post('/api/auth/admin-login')
      .send({ email: 'cad-admin@example.com', password: 'Test1234!' });
    adminToken = adminRes.body.accessToken as string;
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

  function findResolved(list: ResolvedAttr[], key: string): ResolvedAttr {
    const found = list.find((f) => f.key === key);
    if (!found) throw new Error(`attribute "${key}" not found in resolved list`);
    return found;
  }

  async function getWideCardAttrs(slug: string): Promise<ResolvedAttr[]> {
    const res = await request(app.getHttpServer()).get(`/api/categories/${slug}`).expect(200);
    return res.body.wideCardAttributes;
  }

  it('DEFAULT: atributo CON unidad sin showLabel/showUnit configurados → showLabel:false, showUnit:true (regla anterior)', async () => {
    const cat = await createCategory({
      name: 'CAD Con Unidad', slug: uniqueSlug('cad-con-unidad'),
      attributeSchema: [
        { name: 'km', label: 'Kilometraje', type: 'number', unit: 'km', filterable: false, required: false, wideCardAttribute: true },
      ],
    }).expect(201);

    const km = findResolved(await getWideCardAttrs(cat.body.slug), 'km');
    expect(km.showLabel).toBe(false);
    expect(km.showUnit).toBe(true);

    // El mismo default se refleja en GET /categories (árbol) — cardAttributes, lo que consume /busqueda.
    const catCard = await createCategory({
      name: 'CAD Con Unidad Card', slug: uniqueSlug('cad-con-unidad-card'),
      attributeSchema: [
        { name: 'km', label: 'Kilometraje', type: 'number', unit: 'km', filterable: false, required: false, cardAttribute: true },
      ],
    }).expect(201);
    const tree = await request(app.getHttpServer()).get('/api/categories').expect(200);
    const treeNode = (tree.body as Array<{ slug: string; cardAttributes: ResolvedAttr[] }>)
      .find((c) => c.slug === catCard.body.slug);
    const cardAttr = findResolved(treeNode?.cardAttributes ?? [], 'km');
    expect(cardAttr.showLabel).toBe(false);
    expect(cardAttr.showUnit).toBe(true);
  });

  it('DEFAULT: atributo SIN unidad sin configurar → showLabel:true, showUnit:true (regla anterior)', async () => {
    const cat = await createCategory({
      name: 'CAD Sin Unidad', slug: uniqueSlug('cad-sin-unidad'),
      attributeSchema: [
        { name: 'rooms', label: 'Habitaciones', type: 'number', filterable: false, required: false, wideCardAttribute: true },
      ],
    }).expect(201);

    const rooms = findResolved(await getWideCardAttrs(cat.body.slug), 'rooms');
    expect(rooms.showLabel).toBe(true);
    expect(rooms.showUnit).toBe(true);
  });

  it('EXPLÍCITO: showLabel:true en un atributo con unidad → se respeta (no el default)', async () => {
    const cat = await createCategory({
      name: 'CAD Override Label', slug: uniqueSlug('cad-override-label'),
      attributeSchema: [
        { name: 'km', label: 'Kilometraje', type: 'number', unit: 'km', filterable: false, required: false, wideCardAttribute: true, showLabel: true },
      ],
    }).expect(201);

    const km = findResolved(await getWideCardAttrs(cat.body.slug), 'km');
    expect(km.showLabel).toBe(true);
    expect(km.showUnit).toBe(true); // no tocado, sigue en su default
  });

  it('EXPLÍCITO: showUnit:false → se respeta (unidad nunca se añade al valor)', async () => {
    const cat = await createCategory({
      name: 'CAD Override Unit', slug: uniqueSlug('cad-override-unit'),
      attributeSchema: [
        { name: 'km', label: 'Kilometraje', type: 'number', unit: 'km', filterable: false, required: false, wideCardAttribute: true, showUnit: false },
      ],
    }).expect(201);

    const km = findResolved(await getWideCardAttrs(cat.body.slug), 'km');
    expect(km.showLabel).toBe(false); // default, no tocado
    expect(km.showUnit).toBe(false);
  });

  it('herencia: el hijo hereda showLabel/showUnit del padre igual que el resto del atributo', async () => {
    const parent = await createCategory({
      name: 'CAD Padre Herencia', slug: uniqueSlug('cad-padre-herencia'),
      attributeSchema: [
        { name: 'power', label: 'Potencia', type: 'number', unit: 'CV', filterable: false, required: false, wideCardAttribute: true, showLabel: true },
      ],
    }).expect(201);
    const child = await createCategory({
      name: 'CAD Hijo Herencia', slug: uniqueSlug('cad-hijo-herencia'),
      parentId: parent.body.id,
    }).expect(201);

    const power = findResolved(await getWideCardAttrs(child.body.slug), 'power');
    expect(power.showLabel).toBe(true);
    expect(power.showUnit).toBe(true);
  });
});
