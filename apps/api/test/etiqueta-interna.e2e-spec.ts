/**
 * ETIQUETA INTERNA DE MODERACIÓN (P1) — RÁFAGA E1: EL BACKEND.
 *
 * TRES BARRERAS, y las tres van de lo mismo: que la anotación del staff y el
 * estado del anuncio sean **ejes independientes**.
 *
 *   1. Un anuncio nace `NEW` sin que nadie lo escriba — es el `@default`.
 *   2. El dueño edita un `REVIEWED` → `EDITED`; edita un `NEW` → **sigue `NEW`**.
 *      La guarda es la mitad de la regla: marcar `EDITED` algo que nadie había
 *      mirado destruiría el dato útil para poner uno vacío.
 *   3. Lo MANUAL deja traza en `AuditLog`; lo AUTOMÁTICO no — no lleva ningún
 *      dato que el anuncio no tenga ya, y `actorId` exige una persona.
 *
 * Y la cuarta, transversal: cambiar la etiqueta no toca `status`, y cambiar
 * `status` no toca la etiqueta.
 *
 * Ver docs/diseno-etiqueta-interna.md.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Etiqueta interna E1 — el backend (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let ownerToken: string;
  let moderatorToken: string;
  let editorToken: string;
  let ownerId: string;
  let moderatorId: string;
  let categoryId: string;

  const server = () => app.getHttpServer();

  async function crearAnuncio(sufijo: string, extra: Record<string, unknown> = {}) {
    return prisma.listing.create({
      data: {
        title: `Etiqueta ${sufijo}`,
        slug: `etiqueta-${sufijo}-${Math.random().toString(36).slice(2, 8)}`,
        description: 'Descripción original del anuncio.',
        price: 50,
        type: 'PRODUCT',
        status: 'ACTIVE',
        sellerId: ownerId,
        categoryId,
        ...extra,
      },
    });
  }

  const traza = (listingId: string) =>
    prisma.auditLog.findMany({
      where: { resourceType: 'Listing', resourceId: listingId },
      orderBy: { createdAt: 'desc' },
    });

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [owner, moderator] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'etq-owner@example.com', name: 'Etq Owner', slug: 'etq-owner',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'etq-mod@example.com', name: 'Etq Mod', slug: 'etq-mod',
          passwordHash, emailVerified: true, role: 'MODERATOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'etq-editor@example.com', name: 'Etq Editor', slug: 'etq-editor',
          passwordHash, emailVerified: true, role: 'EDITOR',
        },
      }),
    ]);
    ownerId = owner.id;
    moderatorId = moderator.id;

    const category = await prisma.category.create({
      data: { name: 'Etq Cat', slug: 'etq-cat', attributeSchema: [] },
    });
    categoryId = category.id;

    ownerToken = (
      await request(server()).post('/api/auth/login')
        .send({ email: 'etq-owner@example.com', password: 'Test1234!' })
    ).body.accessToken as string;
    moderatorToken = (
      await request(server()).post('/api/auth/admin-login')
        .send({ email: 'etq-mod@example.com', password: 'Test1234!' })
    ).body.accessToken as string;
    editorToken = (
      await request(server()).post('/api/auth/admin-login')
        .send({ email: 'etq-editor@example.com', password: 'Test1234!' })
    ).body.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── BARRERA 1 ─────────────────────────────────────────────────────────────

  describe('BARRERA 1 — nace NEW, sin que nadie lo escriba', () => {
    it('un anuncio creado por la API nace triage=NEW, watched=false', async () => {
      const res = await request(server())
        .post('/api/listings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Etiqueta nace nuevo',
          description: 'Un anuncio recién creado.',
          price: 10,
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          categoryId,
          city: 'Madrid',
          province: 'Madrid',
        });

      expect(res.status).toBe(201);
      const fila = await prisma.listing.findUnique({ where: { id: res.body.id } });
      expect(fila?.triage).toBe('NEW');
      expect(fila?.watched).toBe(false);
    });

    it('el DEFAULT lo pone la base de datos: una fila escrita sin el campo también nace NEW', async () => {
      // Es la prueba de que no hace falta código. `create()` tampoco escribe
      // `status`: se apoya en su `@default(DRAFT)`, y esto es lo mismo.
      const anuncio = await crearAnuncio('default-bd');

      expect(anuncio.triage).toBe('NEW');
      expect(anuncio.watched).toBe(false);
    });
  });

  // ── BARRERA 2 ─────────────────────────────────────────────────────────────

  describe('BARRERA 2 — el dueño edita: REVIEWED → EDITED, con guarda', () => {
    /** Sin `async`: devuelve el `Test` de supertest para poder encadenar `.expect()`. */
    function editar(id: string, token = ownerToken) {
      return request(server())
        .patch(`/api/listings/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'Descripción cambiada por el dueño.' });
    }

    it('REVIEWED → EDITED: lo que el staff dio por bueno ha cambiado', async () => {
      const anuncio = await crearAnuncio('rev-a-edit', { triage: 'REVIEWED' });

      const res = await editar(anuncio.id);
      expect(res.status).toBe(200);

      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(fila?.triage).toBe('EDITED');
    });

    it('NEW se queda NEW — LA GUARDA', async () => {
      // La mitad de la regla, y la que se implementa mal con más facilidad.
      // Nadie lo había mirado: editarlo no produce información nueva.
      const anuncio = await crearAnuncio('new-sigue-new');

      await editar(anuncio.id).expect(200);

      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(fila?.triage).toBe('NEW');
    });

    it('EDITED se queda EDITED: ya está señalado', async () => {
      const anuncio = await crearAnuncio('edit-sigue-edit', { triage: 'EDITED' });

      await editar(anuncio.id).expect(200);

      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(fila?.triage).toBe('EDITED');
    });

    it('editar NO toca `watched`: la bandera es del staff, no del dueño', async () => {
      const anuncio = await crearAnuncio('edit-no-toca-watched', {
        triage: 'REVIEWED',
        watched: true,
      });

      await editar(anuncio.id).expect(200);

      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(fila?.triage).toBe('EDITED');
      expect(fila?.watched).toBe(true);
    });

    it('LOS DOS EJES SE MUEVEN POR SEPARADO: se limpia `needsRevalidation` Y se marca EDITED', async () => {
      // El caso que enseña que la anotación va EN PARALELO al mecanismo, no
      // encima: la edición hace su trabajo de siempre (retirar el aviso si el
      // anuncio vuelve a cumplir) y además deja la señal para el staff.
      const anuncio = await crearAnuncio('dos-ejes', {
        triage: 'REVIEWED',
        needsRevalidation: true,
      });

      await editar(anuncio.id).expect(200);

      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(fila?.needsRevalidation).toBe(false); // el mecanismo
      expect(fila?.triage).toBe('EDITED'); // la anotación
      expect(fila?.status).toBe('ACTIVE'); // y el estado, intacto
    });
  });

  // ── BARRERA 3 ─────────────────────────────────────────────────────────────

  describe('BARRERA 3 — lo manual deja traza; lo automático, no', () => {
    it('el staff marca REVIEWED → queda registrado con SU actorId', async () => {
      const anuncio = await crearAnuncio('traza-manual');

      const res = await request(server())
        .patch(`/api/admin/listings/${anuncio.id}/triage`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ triage: 'REVIEWED' });

      expect(res.status).toBe(200);
      expect(res.body.triage).toBe('REVIEWED');

      const registros = await traza(anuncio.id);
      expect(registros).toHaveLength(1);
      expect(registros[0].action).toBe('LISTING_TRIAGE_CHANGE');
      expect(registros[0].actorId).toBe(moderatorId);
      expect(registros[0].before).toMatchObject({ triage: 'NEW' });
      expect(registros[0].after).toMatchObject({ triage: 'REVIEWED' });
    });

    it('poner y quitar `watched` también deja traza', async () => {
      const anuncio = await crearAnuncio('traza-watched');

      await request(server())
        .patch(`/api/admin/listings/${anuncio.id}/triage`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ watched: true })
        .expect(200);
      await request(server())
        .patch(`/api/admin/listings/${anuncio.id}/triage`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ watched: false })
        .expect(200);

      const registros = await traza(anuncio.id);
      expect(registros).toHaveLength(2);
      expect(registros.every((r) => r.action === 'LISTING_TRIAGE_CHANGE')).toBe(true);
    });

    it('LA TRANSICIÓN AUTOMÁTICA NO GENERA REGISTRO', async () => {
      // No lleva ningún dato que el anuncio no tenga ya: el «quién» es el dueño
      // por definición y el «cuándo» es `updatedAt`. Y `AuditLog.actorId` es NOT
      // NULL con FK a User, así que no hay actor «sistema» que ponerle. Mismo
      // criterio que `needsRevalidation`, que se marca sin traza.
      const anuncio = await crearAnuncio('sin-traza-auto', { triage: 'REVIEWED' });

      await request(server())
        .patch(`/api/listings/${anuncio.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ description: 'Cambiada por el dueño.' })
        .expect(200);

      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(fila?.triage).toBe('EDITED'); // el cambio SÍ ocurrió...
      expect(await traza(anuncio.id)).toHaveLength(0); // ...y no dejó registro
    });

    it('un cambio que no cambia nada no ensucia el historial', async () => {
      const anuncio = await crearAnuncio('idempotente', { triage: 'REVIEWED' });

      await request(server())
        .patch(`/api/admin/listings/${anuncio.id}/triage`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ triage: 'REVIEWED' })
        .expect(200);

      expect(await traza(anuncio.id)).toHaveLength(0);
    });
  });

  // ── ORTOGONALIDAD ─────────────────────────────────────────────────────────

  describe('ORTOGONALIDAD — la etiqueta y el estado no se gobiernan', () => {
    it('cambiar el triaje NO cambia `status` ni `needsRevalidation`', async () => {
      const anuncio = await crearAnuncio('ortog-triaje', { needsRevalidation: true });

      await request(server())
        .patch(`/api/admin/listings/${anuncio.id}/triage`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ triage: 'REVIEWED', watched: true })
        .expect(200);

      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(fila?.status).toBe('ACTIVE');
      expect(fila?.needsRevalidation).toBe(true);
    });

    it('cambiar `status` NO cambia el triaje ni la observación', async () => {
      const anuncio = await crearAnuncio('ortog-status', {
        triage: 'REVIEWED',
        watched: true,
      });

      await request(server())
        .patch(`/api/admin/listings/${anuncio.id}/status`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ status: 'ARCHIVED' })
        .expect(200);

      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(fila?.status).toBe('ARCHIVED');
      expect(fila?.triage).toBe('REVIEWED');
      expect(fila?.watched).toBe(true);
    });

    it('un ACTIVE en observación SIGUE siendo público', async () => {
      // La ortogonalidad vista desde fuera: vigilar no despublica.
      const anuncio = await crearAnuncio('ortog-publico', { status: 'ACTIVE' });

      await request(server())
        .patch(`/api/admin/listings/${anuncio.id}/triage`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ watched: true })
        .expect(200);

      const publico = await request(server()).get(`/api/listings/${anuncio.slug}`);
      expect(publico.status).toBe(200);
    });
  });

  // ── Guardas y permisos ────────────────────────────────────────────────────

  describe('guardas del cambio manual', () => {
    it('EDITED a mano → 400, y el mensaje dice qué SÍ se puede', async () => {
      const anuncio = await crearAnuncio('manual-edited');

      const res = await request(server())
        .patch(`/api/admin/listings/${anuncio.id}/triage`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ triage: 'EDITED' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Nuevo, Revisado/);
    });

    it('un cuerpo vacío → 400 en vez de un 200 que no hace nada', async () => {
      const anuncio = await crearAnuncio('manual-vacio');

      await request(server())
        .patch(`/api/admin/listings/${anuncio.id}/triage`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({})
        .expect(400);
    });

    it('omitir un eje NO pisa el otro', async () => {
      const anuncio = await crearAnuncio('manual-parcial', {
        triage: 'REVIEWED',
        watched: true,
      });

      await request(server())
        .patch(`/api/admin/listings/${anuncio.id}/triage`)
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ watched: false })
        .expect(200);

      const fila = await prisma.listing.findUnique({ where: { id: anuncio.id } });
      expect(fila?.triage).toBe('REVIEWED');
      expect(fila?.watched).toBe(false);
    });

    it('un anuncio inexistente → 404', async () => {
      await request(server())
        .patch('/api/admin/listings/no-existe/triage')
        .set('Authorization', `Bearer ${moderatorToken}`)
        .send({ triage: 'REVIEWED' })
        .expect(404);
    });
  });

  describe('permisos — MODERATOR+, sin fila nueva en el mapa', () => {
    it('un EDITOR recibe 403', async () => {
      const anuncio = await crearAnuncio('perm-editor');

      await request(server())
        .patch(`/api/admin/listings/${anuncio.id}/triage`)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ triage: 'REVIEWED' })
        .expect(403);
    });

    it('el DUEÑO del anuncio recibe 403: la etiqueta es SÓLO del staff', async () => {
      const anuncio = await crearAnuncio('perm-dueno');

      await request(server())
        .patch(`/api/admin/listings/${anuncio.id}/triage`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ triage: 'REVIEWED' })
        .expect(403);
    });
  });
});
