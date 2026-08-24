/**
 * VÍDEO #13 — el listado de `/admin/anuncios` y el vídeo.
 *
 * Dos cosas, y la segunda importa más que la primera:
 *
 *  1. la lista dice SI un anuncio lleva vídeo (`hasVideo`) y se puede filtrar por ello;
 *  2. **NUNCA sirve la dirección**. Es el contrato de cero bytes en listas, sostenido
 *     desde el payload: sin URL, la tabla no puede montar un `<video>` aunque alguien lo
 *     intente. Un test sobre el componente comprobaría que hoy no lo hace; éste comprueba
 *     que no PODRÍA.
 *
 * Ver docs/auditoria-pro-video.md, hueco #13.
 */
import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Vídeo #13 — el listado del backoffice (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let moderatorToken: string;
  let conVideoId: string;
  let sinVideoId: string;

  const VIDEO_URL = `${process.env.S3_PUBLIC_URL}/listing-videos/x/v.mp4`;
  /** Palabra propia de la suite: acota la lista a SUS anuncios. */
  const MARCA = 'flecovideoadmin';

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } }))
      .id;
    const hash = await bcrypt.hash('Test1234!', 4);

    const [moderator, vendedor] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'fleco13-mod@example.com',
          name: 'Mod',
          slug: 'fleco13-mod',
          passwordHash: hash,
          emailVerified: true,
          role: 'MODERATOR',
        },
      }),
      prisma.user.create({
        data: {
          email: 'fleco13-vendedor@example.com',
          name: 'Vendedor',
          slug: 'fleco13-vendedor',
          passwordHash: hash,
          emailVerified: true,
        },
      }),
    ]);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: moderator.email, password: 'Test1234!' });
    moderatorToken = login.body.accessToken;

    const crear = async (sufijo: string, video: boolean) => {
      const l = await prisma.listing.create({
        data: {
          title: `${MARCA} ${sufijo}`,
          slug: `fleco13-${sufijo}`,
          description: 'desc',
          price: new Prisma.Decimal('10.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          // DRAFT a propósito: el filtro del backoffice va a Postgres justamente porque
          // Meilisearch sólo indexa ACTIVE, y el moderador trabaja con los otros estados.
          status: ListingStatus.DRAFT,
          sellerId: vendedor.id,
          categoryId,
          ...(video && { videoUrl: VIDEO_URL, videoDurationSeconds: 30, videoUploadedAt: new Date() }),
        },
        select: { id: true },
      });
      return l.id;
    };

    conVideoId = await crear('con-video', true);
    sinVideoId = await crear('sin-video', false);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const listar = (query = '') =>
    request(app.getHttpServer())
      .get(`/api/admin/listings?q=${MARCA}${query}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

  it('BARRERA — la lista dice qué anuncios llevan vídeo', async () => {
    const res = await listar();
    const porId = Object.fromEntries(
      res.body.items.map((l: { id: string; hasVideo: boolean }) => [l.id, l.hasVideo]),
    );

    expect(porId[conVideoId]).toBe(true);
    expect(porId[sinVideoId]).toBe(false);
  });

  it('REQUISITO DE ORO — y NO sirve la dirección: sin URL no hay `<video>` posible', async () => {
    const res = await listar();

    // Sobre el JSON ENTERO, no campo a campo: si alguien añade `videoUrl` a la lista por
    // cualquier vía —el select, un spread, una relación— esto cae.
    expect(JSON.stringify(res.body)).not.toContain('listing-videos/');
    expect(res.body.items.every((l: Record<string, unknown>) => !('videoUrl' in l))).toBe(true);
  });

  it('el filtro acota a los que llevan vídeo', async () => {
    const res = await listar('&conVideo=true');
    const ids = res.body.items.map((l: { id: string }) => l.id);

    expect(ids).toContain(conVideoId);
    expect(ids).not.toContain(sinVideoId);
  });

  it('y `false` es la pregunta CONTRARIA, no «me da igual»', async () => {
    const res = await listar('&conVideo=false');
    const ids = res.body.items.map((l: { id: string }) => l.id);

    expect(ids).toContain(sinVideoId);
    expect(ids).not.toContain(conVideoId);
  });

  it('sin el parámetro no filtra: salen los dos', async () => {
    const res = await listar();
    const ids = res.body.items.map((l: { id: string }) => l.id);

    expect(ids).toEqual(expect.arrayContaining([conVideoId, sinVideoId]));
  });
});
