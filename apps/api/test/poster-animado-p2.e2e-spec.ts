/**
 * PÓSTER ANIMADO P2 — EL HOVER, por el lado de los datos (e2e).
 *
 * P1 guardó el sprite; P2 lo **enseña**. Lo que se fija aquí es lo que la tarjeta recibe —el
 * hover en sí es CSS y se prueba en el unitario del componente— y sobre todo **lo que sigue
 * sin recibir**.
 *
 * LA TENSIÓN DE ESTA RÁFAGA, en una frase: se abre el payload de tarjeta a una URL de vídeo
 * por primera vez, y hay que demostrar que **la que se abre no es la del vídeo**.
 *
 *   · B-1 — el barrido, **ahora de verdad**: con `videoPreviewUrl` viajando, el payload
 *           SIGUE sin contener `listing-videos/`. En P1 este test no podía probar nada (la
 *           URL no viajaba); aquí es donde se gana.
 *   · B-2 — el `select` NO se ensancha: la tarjeta trae el sprite y **sigue sin traer**
 *           `videoUrl` ni `videoPosterUrl`.
 *   · La superficie de más tráfico: las tarjetas de BÚSQUEDA no pasan por Postgres, así que
 *           el sprite tiene que estar también en el documento de Meilisearch.
 *   · `/planes`: la línea se DERIVA y dice **«en ordenador»** — la animación no existe en
 *           móvil (decisión de producto (b)), y prometerla sería anunciar lo que no se da.
 */

import { INestApplication } from '@nestjs/common';
import { ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb } from './helpers/db';
import { ajustesDeSuite } from './helpers/settings';
import { SearchService, INDEX_INCLUDE } from 'src/modules/search/search.service';
import {
  PREVIEW_KEY_PREFIX,
  VIDEO_ENABLED_SETTING,
  VIDEO_KEY_PREFIX,
} from 'src/modules/video/video-limits';

const INDEX_NAME = process.env.MEILI_INDEX_NAME ?? 'listings_test';

describe('Póster animado P2 — el hover: qué recibe la tarjeta (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  let search: SearchService;

  let sellerId: string;
  let sellerToken: string;
  let categoryId: string;

  const VIDEO_URL = `${process.env.S3_PUBLIC_URL}/${VIDEO_KEY_PREFIX}/x/v.mp4`;
  const POSTER_URL = `${process.env.S3_PUBLIC_URL}/media/p.jpg`;
  const PREVIEW_URL = `${process.env.S3_PUBLIC_URL}/${PREVIEW_KEY_PREFIX}/x/s.webp`;

  ajustesDeSuite({ [VIDEO_ENABLED_SETTING]: true });

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    meili = buildMeiliClient();
    search = app.get(SearchService);

    categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } })).id;
    const seller = await prisma.user.create({
      data: {
        email: 'p2-seller@example.com',
        name: 'P2',
        slug: 'p2-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    sellerId = seller.id;
    sellerToken = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'p2-seller@example.com', password: 'Test1234!' })
        .expect(200)
    ).body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let n = 0;
  /** Un anuncio con los TRES artefactos escritos a mano: aquí se mide qué SALE, no cómo entró. */
  async function crearAnuncio(marca: string, conVideo: boolean) {
    n += 1;
    return prisma.listing.create({
      data: {
        title: `P2 ${marca}`,
        slug: `p2-${marca}-${n}-${Math.random().toString(36).slice(2)}`,
        description: 'Anuncio para el hover del póster animado',
        price: new Prisma.Decimal('80.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        sellerId,
        categoryId,
        publishedAt: new Date(),
        ...(conVideo
          ? {
              videoUrl: VIDEO_URL,
              videoPosterUrl: POSTER_URL,
              videoPreviewUrl: PREVIEW_URL,
              videoDurationSeconds: 20,
              videoUploadedAt: new Date(),
            }
          : {}),
      },
      select: { id: true, slug: true },
    });
  }

  const misAnuncios = () =>
    request(app.getHttpServer())
      .get('/api/users/me/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

  const tarjetaDe = (body: { items: Record<string, unknown>[] }, id: string) =>
    body.items.find((l) => l.id === id)!;

  // ═══════════════════════════════════════════════════════════════════════════
  //  B-2 — el select se abre al sprite y a NADA MÁS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('B-2 — la tarjeta trae el sprite, y sigue sin traer el vídeo', () => {
    it('viaja `videoPreviewUrl`; NO viajan `videoUrl` ni `videoPosterUrl`', async () => {
      const anuncio = await crearAnuncio('b2', true);

      const res = await misAnuncios();
      const tarjeta = tarjetaDe(res.body, anuncio.id);

      // Lo que P2 abre: la dirección de una IMAGEN de 20-45 KB, del orden de la portada.
      expect(tarjeta.videoPreviewUrl).toBe(PREVIEW_URL);
      expect(tarjeta.hasVideo).toBe(true);

      // Y lo que NO se abre «ya que estamos». Comprobar la AUSENCIA campo a campo —y no
      // sólo el barrido de cadena— es lo que caza un `select` ensanchado que volviera con
      // los campos a null.
      expect(tarjeta.videoUrl).toBeUndefined();
      expect(tarjeta.videoPosterUrl).toBeUndefined();
    });

    it('un anuncio SIN vídeo no trae previsualización: `null`, no una cadena vacía', async () => {
      const anuncio = await crearAnuncio('b2-sin-video', false);

      const tarjeta = tarjetaDe((await misAnuncios()).body, anuncio.id);
      expect(tarjeta.hasVideo).toBe(false);
      // El fallback tiene que ser distinguible: la tarjeta pregunta por él para decidir si
      // monta la capa de animación (B-6, en el unitario del componente).
      expect(tarjeta.videoPreviewUrl).toBeNull();
    });

    it('y la FICHA sigue sin servirlo: el sprite es de las listas, no del reproductor', async () => {
      const anuncio = await crearAnuncio('b2-ficha', true);

      const res = await request(app.getHttpServer())
        .get(`/api/listings/${anuncio.slug}`)
        .expect(200);

      // En la ficha el vídeo se REPRODUCE, así que ahí no pinta nada una tira de cinco
      // fotogramas. La lista blanca de la ficha no se ensancha tampoco en esta dirección.
      expect(res.body.videoUrl).toBe(VIDEO_URL);
      expect(res.body.videoPreviewUrl).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  B-1 — el barrido, ahora con la URL viajando
  // ═══════════════════════════════════════════════════════════════════════════

  describe('B-1 — se abre el payload a una URL, y NO es la del vídeo', () => {
    /**
     * ESTE ES EL TEST QUE P2 HACE VALIOSO. En P1 el mismo barrido no podía probar nada:
     * `videoPreviewUrl` no viajaba, así que no había forma de que el sprite filtrase el
     * prefijo del vídeo aunque estuviera guardado ahí. Ahora la URL SÍ viaja — y sigue sin
     * contener `listing-videos/`, porque el sprite vive en un prefijo propio.
     *
     * Ésa es la garantía entera, dicha con precisión: **la dirección del `.mp4` nunca viaja
     * a una lista; la del sprite —que es una imagen— sí puede.**
     */
    it('con el sprite en el payload, el barrido de `listing-videos/` sigue limpio', async () => {
      await crearAnuncio('b1-barrido', true);

      const res = await misAnuncios();
      const json = JSON.stringify(res.body);

      // La prueba de que el barrido está mirando algo: el sprite está ahí.
      expect(json).toContain(`${PREVIEW_KEY_PREFIX}/`);
      // Y la garantía: la dirección del vídeo, no.
      expect(json).not.toContain(`${VIDEO_KEY_PREFIX}/`);
    });

    it('lo mismo en FAVORITOS, la lista que en su día se quedó sin barrer', async () => {
      const anuncio = await crearAnuncio('b1-favoritos', true);
      await request(app.getHttpServer())
        .post(`/api/favorites/${anuncio.id}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/favorites')
        .set('Authorization', `Bearer ${sellerToken}`)
        .expect(200);

      // Favoritos servía la fila cruda y por ahí se colaron en su día la URL del vídeo y el
      // teléfono. Pasa por `toSummary` desde entonces, así que hereda esta apertura y esta
      // garantía sin tocar nada — que es la ventaja de que haya un solo lector.
      const json = JSON.stringify(res.body);
      expect(json).toContain(`${PREVIEW_KEY_PREFIX}/`);
      expect(json).not.toContain(`${VIDEO_KEY_PREFIX}/`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  La búsqueda — la superficie de más tráfico no pasa por Postgres
  // ═══════════════════════════════════════════════════════════════════════════

  describe('el documento indexado lleva el sprite', () => {
    it('Meilisearch guarda `videoPreviewUrl` y sigue sin guardar la URL del vídeo', async () => {
      const anuncio = await crearAnuncio('meili', true);

      const fila = await prisma.listing.findUniqueOrThrow({
        where: { id: anuncio.id },
        include: INDEX_INCLUDE,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await search.indexListing(fila as any);

      const doc = (await meili.index(INDEX_NAME).getDocument(anuncio.id)) as Record<string, unknown>;

      // Sin esto, la búsqueda —que es de donde salen la mayoría de las tarjetas— sería la
      // ÚNICA superficie sin previsualización, porque no pasa por Postgres.
      expect(doc.videoPreviewUrl).toBe(PREVIEW_URL);
      expect(doc.hasVideo).toBe(true);
      // Y el documento sigue sin la dirección del vídeo, igual que siempre.
      expect(doc.videoUrl).toBeUndefined();
      expect(JSON.stringify(doc)).not.toContain(`${VIDEO_KEY_PREFIX}/`);
    });

    it('un anuncio sin vídeo se indexa con `videoPreviewUrl` a null', async () => {
      const anuncio = await crearAnuncio('meili-sin', false);
      const fila = await prisma.listing.findUniqueOrThrow({
        where: { id: anuncio.id },
        include: INDEX_INCLUDE,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await search.indexListing(fila as any);

      const doc = (await meili.index(INDEX_NAME).getDocument(anuncio.id)) as Record<string, unknown>;
      expect(doc.videoPreviewUrl).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  /planes — la línea derivada, con «en ordenador»
  // ═══════════════════════════════════════════════════════════════════════════

  describe('`/planes` anuncia la previsualización sin prometerla en móvil', () => {
    const beneficios = async (): Promise<string[]> => {
      const res = await request(app.getHttpServer()).get('/api/billing/catalog').expect(200);
      return res.body.proBenefits as string[];
    };

    it('la línea existe y dice «en ordenador» — el hover no existe en táctil', async () => {
      const linea = (await beneficios()).find((b) => b.toLowerCase().includes('previsualización'));

      expect(linea).toBeDefined();
      // LA HONESTIDAD DE LA LÍNEA. La animación vive tras `@media (hover: hover)`, así que
      // media plataforma no la ve. Prometérsela a todo el mundo sería anunciar lo que no se
      // concede — justo lo que `buildProBenefits` vino a cerrar.
      expect(linea).toContain('en ordenador');
    });

    it('y desaparece con el vídeo: si el flag se apaga, no se promete ninguna de las dos', async () => {
      await prisma.setting.update({
        where: { key: VIDEO_ENABLED_SETTING },
        data: { value: false },
      });
      try {
        const lista = await beneficios();
        // Bajo la MISMA condición que el vídeo, no bajo una nueva: la previsualización es
        // parte del vídeo y se concede y se retira con él. Un ajuste propio serían dos
        // verdades que mantener sincronizadas.
        expect(lista.some((b) => b.toLowerCase().includes('previsualización'))).toBe(false);
        expect(lista.some((b) => b.toLowerCase().startsWith('vídeo en tus anuncios'))).toBe(false);
      } finally {
        await prisma.setting.update({
          where: { key: VIDEO_ENABLED_SETTING },
          data: { value: true },
        });
      }
    });
  });
});
