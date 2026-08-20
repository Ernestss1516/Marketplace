/**
 * P3a — EL STAFF EDITA LOS CAMPOS DE UN ANUNCIO AJENO.
 *
 * LA BARRERA, Y SE MIDE EN LAS DOS DIRECCIONES a propósito:
 *
 *   (a) el staff edita un anuncio `REVIEWED` → el campo cambia y **el triaje NO
 *       se mueve**;
 *   (b) el DUEÑO edita ese mismo anuncio → **sí** pasa a `EDITED`.
 *
 * Medir sólo (a) dejaría pasar el error más tonto y más grave: alguien desactiva
 * la transición para todo el mundo y «el staff no dispara EDITED» sigue en verde
 * mientras la única señal que P1 construyó ha dejado de existir. (b) es lo que lo
 * caza.
 *
 * Y la segunda mitad: el staff **valida igual que el dueño**. Dejarle escribir un
 * anuncio inválido «porque es de confianza» produce una fila que el propio
 * sistema marca acto seguido, con el aviso cayéndole al VENDEDOR por un cambio
 * que no hizo.
 *
 * Ver docs/diseno-editar-anuncio.md §1.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('P3a — la edición de staff (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let ownerToken: string;
  let moderatorToken: string;
  let editorToken: string;
  let moderatorId: string;
  let ownerId: string;
  let categoryId: string;
  let categoriaConAtributosId: string;

  const server = () => app.getHttpServer();
  const MOTIVO = 'Corrección de contenido reportado';

  async function crearAnuncio(sufijo: string, extra: Record<string, unknown> = {}) {
    return prisma.listing.create({
      data: {
        title: `P3a ${sufijo}`,
        slug: `p3a-${sufijo}-${Math.random().toString(36).slice(2, 8)}`,
        description: 'Descripción original del anuncio.',
        price: 100,
        type: 'PRODUCT',
        status: 'ACTIVE',
        sellerId: ownerId,
        categoryId,
        ...extra,
      },
    });
  }

  const editarComoStaff = (id: string, body: Record<string, unknown>, token = moderatorToken) =>
    request(server())
      .patch(`/api/admin/listings/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: MOTIVO, ...body });

  const editarComoDueno = (id: string, body: Record<string, unknown>) =>
    request(server())
      .patch(`/api/listings/${id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(body);

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [owner, moderator] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'p3a-owner@example.com', name: 'P3a Owner', slug: 'p3a-owner',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'p3a-mod@example.com', name: 'P3a Mod', slug: 'p3a-mod',
          passwordHash, emailVerified: true, role: 'MODERATOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'p3a-editor@example.com', name: 'P3a Editor', slug: 'p3a-editor',
          passwordHash, emailVerified: true, role: 'EDITOR',
        },
      }),
    ]);
    ownerId = owner.id;
    moderatorId = moderator.id;

    const cat = await prisma.category.create({
      data: { name: 'P3a Cat', slug: 'p3a-cat', attributeSchema: [] },
    });
    categoryId = cat.id;

    // Una categoría CON atributos requeridos: es la que permite comprobar que el
    // staff no se salta las validaciones.
    const catAttr = await prisma.category.create({
      data: {
        name: 'P3a Con atributos',
        slug: 'p3a-con-atributos',
        attributeSchema: [
          { name: 'marca', label: 'Marca', type: 'text', filterable: false, required: true },
        ],
      },
    });
    categoriaConAtributosId = catAttr.id;

    ownerToken = (
      await request(server()).post('/api/auth/login')
        .send({ email: 'p3a-owner@example.com', password: 'Test1234!' })
    ).body.accessToken as string;
    const adminLogin = (email: string) =>
      request(server()).post('/api/auth/admin-login').send({ email, password: 'Test1234!' });
    moderatorToken = (await adminLogin('p3a-mod@example.com')).body.accessToken as string;
    editorToken = (await adminLogin('p3a-editor@example.com')).body.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── LA BARRERA, EN LAS DOS DIRECCIONES ────────────────────────────────────

  describe('LA BARRERA — quién mueve el triaje y quién no', () => {
    it('(a) el STAFF edita el precio → cambia, y el triaje NO se mueve', async () => {
      const anuncio = await crearAnuncio('staff-no-mueve', { triage: 'REVIEWED' });

      const res = await editarComoStaff(anuncio.id, { price: 55 });

      expect(res.status).toBe(200);
      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(Number(fila?.price)).toBe(55);
      expect(fila?.triage).toBe('REVIEWED'); // ← intacto
    });

    it('(b) el DUEÑO edita ese mismo anuncio → SÍ pasa a EDITED', async () => {
      // El contraste. Sin este test, desactivar la transición para todo el mundo
      // dejaría (a) en verde y la señal de P1 muerta.
      const anuncio = await crearAnuncio('dueno-si-mueve', { triage: 'REVIEWED' });

      await editarComoDueno(anuncio.id, { price: 55 }).expect(200);

      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(fila?.triage).toBe('EDITED');
    });

    it('y el staff editando DESPUÉS tampoco lo devuelve atrás', async () => {
      const anuncio = await crearAnuncio('staff-tras-dueno', { triage: 'EDITED' });

      await editarComoStaff(anuncio.id, { title: 'P3a Retocado' }).expect(200);

      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(fila?.triage).toBe('EDITED');
    });

    it.each([['NEW'], ['REVIEWED'], ['EDITED']])(
      'el staff editando un %s lo deja donde estaba',
      async (triage) => {
        const anuncio = await crearAnuncio(`staff-${triage.toLowerCase()}`, { triage });

        await editarComoStaff(anuncio.id, { description: 'Descripción corregida por el equipo.' })
          .expect(200);

        const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
        expect(fila?.triage).toBe(triage);
      },
    );
  });

  // ── El staff valida igual ─────────────────────────────────────────────────

  describe('el staff valida IGUAL que el dueño', () => {
    it('mover a una categoría con atributos requeridos sin darlos → 422', async () => {
      const anuncio = await crearAnuncio('valida-requeridos');

      const res = await editarComoStaff(anuncio.id, { categoryId: categoriaConAtributosId });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/marca/i);
    });

    it('y el DUEÑO recibe exactamente el mismo rechazo', async () => {
      // La prueba de que son LAS MISMAS reglas y no dos copias que se parecen.
      const anuncio = await crearAnuncio('valida-igual-dueno');

      const res = await editarComoDueno(anuncio.id, { categoryId: categoriaConAtributosId });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/marca/i);
    });

    it('con el atributo requerido, la edición del staff pasa', async () => {
      const anuncio = await crearAnuncio('valida-ok');

      await editarComoStaff(anuncio.id, {
        categoryId: categoriaConAtributosId,
        attributes: { marca: 'Acme' },
      }).expect(200);

      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(fila?.categoryId).toBe(categoriaConAtributosId);
    });

    it('un atributo no reconocido se rechaza igual', async () => {
      const anuncio = await crearAnuncio('valida-desconocido');

      const res = await editarComoStaff(anuncio.id, {
        categoryId: categoriaConAtributosId,
        attributes: { marca: 'Acme', inventado: 'x' },
      });

      expect(res.status).toBe(422);
      expect(res.body.message).toMatch(/inventado/i);
    });

    it('el motivo es OBLIGATORIO', async () => {
      const anuncio = await crearAnuncio('sin-motivo');

      await request(server())
        .patch(`/api/admin/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ price: 10 })
        .expect(400);
    });
  });

  // ── Lo que NO hace ────────────────────────────────────────────────────────

  describe('lo que la edición de staff NO toca', () => {
    it('no cambia el `status` — eso tiene su vía (M2)', async () => {
      const anuncio = await crearAnuncio('no-status', { status: 'PENDING_REVIEW' });

      await editarComoStaff(anuncio.id, { title: 'P3a Otro título' }).expect(200);

      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      // Sigue en la cola: editarlo no lo aprueba ni lo saca.
      expect(fila?.status).toBe('PENDING_REVIEW');
    });

    it('el DTO no admite `status` ni `sellerId` aunque se manden', async () => {
      const anuncio = await crearAnuncio('dto-cerrado');
      const otro = await prisma.user.findFirst({ where: { email: 'p3a-mod@example.com' } });

      const res = await editarComoStaff(anuncio.id, {
        status: 'ACTIVE',
        sellerId: otro!.id,
      });

      // `forbidNonWhitelisted` los rechaza: no se cuelan en silencio.
      expect(res.status).toBe(400);
      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(fila?.sellerId).toBe(ownerId);
    });

    it('no toca `needsRevalidation`', async () => {
      const anuncio = await crearAnuncio('no-revalidacion', { needsRevalidation: true });

      await editarComoStaff(anuncio.id, { title: 'P3a Título nuevo' }).expect(200);

      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(fila?.needsRevalidation).toBe(true);
    });
  });

  // ── La traza ──────────────────────────────────────────────────────────────

  describe('la traza', () => {
    it('registra QUIÉN editó, QUÉ había antes y POR QUÉ', async () => {
      const anuncio = await crearAnuncio('traza');

      await editarComoStaff(anuncio.id, { title: 'P3a Título corregido' }).expect(200);

      const registros = await prisma.auditLog.findMany({
        where: { resourceType: 'Listing', resourceId: anuncio.id, action: 'LISTING_EDIT' },
      });
      expect(registros).toHaveLength(1);
      expect(registros[0].actorId).toBe(moderatorId);
      expect(registros[0].before).toMatchObject({ title: anuncio.title });
      expect(registros[0].after).toMatchObject({
        title: 'P3a Título corregido',
        reason: MOTIVO,
      });
    });

    it('la edición del DUEÑO no genera `LISTING_EDIT` — es otra cosa', async () => {
      const anuncio = await crearAnuncio('traza-dueno');

      await editarComoDueno(anuncio.id, { title: 'P3a Cambiado por el dueño' }).expect(200);

      const registros = await prisma.auditLog.findMany({
        where: { resourceId: anuncio.id, action: 'LISTING_EDIT' },
      });
      expect(registros).toHaveLength(0);
    });
  });

  // ── Permisos ──────────────────────────────────────────────────────────────

  describe('permisos — MODERATOR+', () => {
    it('un EDITOR recibe 403', async () => {
      const anuncio = await crearAnuncio('perm-editor');

      await editarComoStaff(anuncio.id, { price: 10 }, editorToken).expect(403);
    });

    it('el DUEÑO no entra por la puerta del staff', async () => {
      const anuncio = await crearAnuncio('perm-dueno');

      await editarComoStaff(anuncio.id, { price: 10 }, ownerToken).expect(403);
    });

    it('un anuncio inexistente → 404', async () => {
      await request(server())
        .patch('/api/admin/listings/no-existe')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ reason: MOTIVO, price: 10 })
        .expect(404);
    });
  });
});
