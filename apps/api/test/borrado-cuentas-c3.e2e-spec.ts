import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

/**
 * BORRADO DE CUENTAS — C3: EL GATE DE VISIBILIDAD.
 *
 * La regla que estas barreras fijan: **una cuenta oculta desaparece del
 * ESCAPARATE, no de TU HISTORIAL.**
 *
 *   1. Perfil, anuncios del vendedor y valoraciones de un ARCHIVED o un BANNED →
 *      404, **el mismo que un slug que no existe** (un 404 distinguible sería un
 *      delator).
 *   2. El buscador de usuarios deja de devolverlos.
 *   3. **El historial se conserva** — el comprador sigue viendo su hilo entero y
 *      la valoración que recibió. Es la barrera que impide pasarse de frenada y
 *      destruir el lado del otro.
 *   4. Un SUSPENDED **sigue visible**: su sanción es temporal.
 */
describe('Borrado de cuentas C3 — el gate de visibilidad (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;
  let hash: string;

  const PASSWORD = 'Test1234!';

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    hash = await bcrypt.hash(PASSWORD, 4);
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = cat.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let n = 0;
  async function crearUsuario(marca: string, status: UserStatus = 'ACTIVE') {
    n += 1;
    return prisma.user.create({
      data: {
        email: `c3-${marca}-${n}@example.com`,
        name: `C3 ${marca}`,
        slug: `c3-${marca}-${n}`,
        passwordHash: hash,
        emailVerified: true,
        status,
      },
    });
  }

  async function crearAnuncioActivo(sellerId: string, marca: string) {
    n += 1;
    return prisma.listing.create({
      data: {
        title: `C3 ${marca}`,
        slug: `c3-anuncio-${marca}-${n}`,
        description: 'descripción de prueba con longitud suficiente',
        price: new Prisma.Decimal('20.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'ACTIVE',
        sellerId,
        categoryId,
        publishedAt: new Date(),
      },
    });
  }

  async function tokenDe(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 1 — las tres superficies de `/users/:slug` se cierran
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Barrera 1 — perfil, anuncios y valoraciones: 404 indistinguible', () => {
    const OCULTOS: UserStatus[] = ['ARCHIVED', 'BANNED', 'DELETED'];

    it.each(OCULTOS)('el perfil público de un %s → 404', async (status) => {
      const user = await crearUsuario(`perfil-${status.toLowerCase()}`, status);
      await request(app.getHttpServer()).get(`/api/users/${user.slug}`).expect(404);
    });

    it.each(OCULTOS)('los anuncios de un %s → 404 (aunque los tenga ACTIVE)', async (status) => {
      const user = await crearUsuario(`anuncios-${status.toLowerCase()}`, status);
      // Con un anuncio ACTIVE de verdad: lo que cierra la puerta es el estado de
      // la CUENTA, no que no tenga nada que enseñar.
      await crearAnuncioActivo(user.id, `de-${status.toLowerCase()}`);

      await request(app.getHttpServer()).get(`/api/users/${user.slug}/listings`).expect(404);
    });

    it.each(OCULTOS)('las valoraciones de un %s → 404', async (status) => {
      const user = await crearUsuario(`reviews-${status.toLowerCase()}`, status);
      await request(app.getHttpServer()).get(`/api/users/${user.slug}/reviews`).expect(404);
    });

    /**
     * LO QUE DE VERDAD SE PRUEBA AQUÍ. Que un oculto dé 404 no basta: si un slug
     * INEXISTENTE diera otra cosa —un 200 con la lista vacía, que es lo que
     * `/listings` hacía antes de C3—, entonces **el 404 confirmaría que la cuenta
     * existe**, y archivarse dejaría de esconder nada.
     */
    it('un slug INEXISTENTE responde exactamente igual que uno oculto en las tres', async () => {
      const oculto = await crearUsuario('indistinguible', 'ARCHIVED');
      const fantasma = 'c3-no-existe-jamas';

      for (const ruta of ['', '/listings', '/reviews']) {
        const rOculto = await request(app.getHttpServer()).get(`/api/users/${oculto.slug}${ruta}`);
        const rFantasma = await request(app.getHttpServer()).get(`/api/users/${fantasma}${ruta}`);

        expect(rOculto.status).toBe(rFantasma.status);
        expect(rOculto.status).toBe(404);
        expect(rOculto.body.message).toEqual(rFantasma.body.message);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 2 — el buscador
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Barrera 2 — el buscador de usuarios deja de devolverlos', () => {
    it('un ARCHIVED y un BANNED no salen; un ACTIVE y un SUSPENDED sí', async () => {
      const quienBusca = await crearUsuario('busca');
      const token = await tokenDe(quienBusca.email);

      // Nombre común para que los cuatro caigan en la misma consulta.
      const marca = `zzbuscable${Date.now()}`;
      const crear = async (status: UserStatus) => {
        n += 1;
        return prisma.user.create({
          data: {
            email: `c3-${marca}-${status}-${n}@example.com`,
            name: `${marca} ${status}`,
            slug: `c3-${marca}-${status.toLowerCase()}-${n}`,
            passwordHash: hash,
            emailVerified: true,
            status,
          },
        });
      };
      const activo = await crear('ACTIVE');
      const suspendido = await crear('SUSPENDED');
      const archivado = await crear('ARCHIVED');
      const baneado = await crear('BANNED');

      const res = await request(app.getHttpServer())
        .get(`/api/users/search?q=${marca}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const ids = (res.body as { id: string }[]).map((u) => u.id);
      expect(ids).toContain(activo.id);
      expect(ids).toContain(suspendido.id); // deliberado: la sanción caduca sola
      expect(ids).not.toContain(archivado.id);
      expect(ids).not.toContain(baneado.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 3 — el historial NO se toca
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * LA BARRERA QUE IMPIDE PASARSE DE FRENADA.
   *
   * Es tentador leer «ocultar la cuenta» como «ocultar todo lo suyo», y sería un
   * error: el hilo de mensajes y la valoración que un tercero recibió **no son
   * suyos, son de dos**. Ocultarlos no protegería a nadie —el comprador ya los
   * leyó— y destruiría el lado del otro, que es lo que el principio rector de
   * todo el cuerpo prohíbe.
   */
  describe('Barrera 3 — el comprador conserva su historial con la cuenta oculta', () => {
    it('sigue viendo el hilo entero, con los mensajes de quien se fue', async () => {
      const vendedor = await crearUsuario('vendedor-hilo');
      const comprador = await crearUsuario('comprador-hilo');
      const anuncio = await crearAnuncioActivo(vendedor.id, 'del-hilo');

      const tokenComprador = await tokenDe(comprador.email);
      const conv = await request(app.getHttpServer())
        .post('/api/conversations')
        .set('Authorization', `Bearer ${tokenComprador}`)
        .send({ listingId: anuncio.id, message: '¿Sigue disponible?' })
        .expect(201);
      const conversationId = conv.body.id as string;

      // El vendedor contesta, para que el hilo tenga las DOS voces.
      const tokenVendedor = await tokenDe(vendedor.email);
      await request(app.getHttpServer())
        .post(`/api/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${tokenVendedor}`)
        .send({ body: 'Sí, disponible' })
        .expect(201);

      // El vendedor se va.
      await prisma.user.update({
        where: { id: vendedor.id },
        data: { status: UserStatus.ARCHIVED },
      });

      const hilo = await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${tokenComprador}`)
        .expect(200);

      const cuerpos = (hilo.body.messages as { body: string }[]).map((m) => m.body);
      expect(cuerpos).toContain('¿Sigue disponible?');
      expect(cuerpos).toContain('Sí, disponible'); // ← el mensaje del que se fue

      // Y el hilo sigue en su bandeja: no desaparece de la lista.
      const bandeja = await request(app.getHttpServer())
        .get('/api/conversations')
        .set('Authorization', `Bearer ${tokenComprador}`)
        .expect(200);
      expect((bandeja.body.items as { id: string }[]).map((c) => c.id)).toContain(conversationId);
    });

    it('sigue viendo en SU perfil la valoración que recibió de quien se fue', async () => {
      const autor = await crearUsuario('autor-valoracion');
      const receptor = await crearUsuario('receptor-valoracion');
      const anuncio = await crearAnuncioActivo(receptor.id, 'valorado');

      await prisma.review.create({
        data: {
          rating: 5,
          comment: 'Trato inmejorable',
          authorId: autor.id,
          targetId: receptor.id,
          listingId: anuncio.id,
          listingTitle: anuncio.title,
        },
      });

      // El AUTOR de la valoración se archiva.
      await prisma.user.update({ where: { id: autor.id }, data: { status: UserStatus.ARCHIVED } });

      const res = await request(app.getHttpServer())
        .get(`/api/users/${receptor.slug}/reviews`)
        .expect(200);

      // La valoración sigue ahí Y sigue contando para la media: es del receptor
      // tanto como de quien la escribió.
      expect((res.body.items as { comment: string }[]).map((r) => r.comment)).toContain(
        'Trato inmejorable',
      );
      expect(res.body.average).toBe(5);
      expect(res.body.count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 4 — SUSPENDED sigue en el escaparate
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Barrera 4 — un suspendido sigue visible', () => {
    it('su perfil, sus anuncios y sus valoraciones se sirven con normalidad', async () => {
      const user = await crearUsuario('suspendido-visible', 'SUSPENDED');
      await crearAnuncioActivo(user.id, 'de-suspendido');

      await request(app.getHttpServer()).get(`/api/users/${user.slug}`).expect(200);
      const listados = await request(app.getHttpServer())
        .get(`/api/users/${user.slug}/listings`)
        .expect(200);
      expect(listados.body.total).toBe(1);
      await request(app.getHttpServer()).get(`/api/users/${user.slug}/reviews`).expect(200);
    });

    /**
     * El porqué, no sólo el qué: esconder a un suspendido significaría sacar sus
     * anuncios del índice y volver a meterlos cuando la sanción caduque —días
     * después—, por algo que se deshace solo. `BANNED` y `ARCHIVED` no caducan.
     */
    it('un ACTIVE se sirve igual: el gate no es un candado general', async () => {
      const user = await crearUsuario('activo-visible');
      await request(app.getHttpServer()).get(`/api/users/${user.slug}`).expect(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  El hueco que venía de antes de este cuerpo
  // ═══════════════════════════════════════════════════════════════════════════

  describe('El baneado, que llevaba desde siempre con el perfil público', () => {
    it('deja de tener perfil, valoraciones y presencia en el buscador', async () => {
      const baneado = await crearUsuario('hueco-viejo', 'BANNED');
      const quienBusca = await crearUsuario('busca-baneado');
      const token = await tokenDe(quienBusca.email);

      await request(app.getHttpServer()).get(`/api/users/${baneado.slug}`).expect(404);
      await request(app.getHttpServer()).get(`/api/users/${baneado.slug}/reviews`).expect(404);

      const res = await request(app.getHttpServer())
        .get(`/api/users/search?q=${baneado.name}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((res.body as { id: string }[]).map((u) => u.id)).not.toContain(baneado.id);
    });
  });
});
