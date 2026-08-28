import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { ListingsService } from 'src/modules/listings/listings.service';
import { NOTIFICATION_JOB } from 'src/infra/queue/notification.types';

/**
 * NOTIFICACIONES A1 — EL CORREO DE «VALORA TU TRATO» LLEVABA A UN 404.
 *
 * ── EL DEFECTO ──────────────────────────────────────────────────────────────
 *
 * `closeDeal` avisa a las dos partes por in-app y por correo. El aviso in-app
 * llevaba al deep-link de valoración en el perfil del otro; **el correo llevaba a
 * `/anuncio/{slug}`**. Y unas líneas más abajo, ese mismo `closeDeal` deja el
 * anuncio en `SOLD` cuando es un PRODUCTO — que es el caso normal.
 *
 * La ficha pública sólo sirve los `ACTIVE`. O sea que el enlace se rompía **por
 * cerrar el trato del que hablaba**, en todos los tratos de producto.
 *
 * Es el mismo defecto de clase que `lib/admin-links.ts` erradicó del backoffice
 * («una ruta que da 404 para todo lo que no esté ACTIVE»), sobrevivido en el
 * correo porque aquel helper vive en el front y el processor está en el back.
 *
 * ── QUÉ FIJA ESTA SUITE ─────────────────────────────────────────────────────
 *
 * Que el correo lleve a un destino que **no depende del estado del anuncio**, y
 * que sea EL MISMO que el aviso in-app (§A1.3, los dos canales dicen lo mismo).
 * Se comprueba sobre el payload del job, que es donde se decide: el enlace lo
 * arma el processor a partir de estos campos, y `listingSlug` ya no viaja
 * precisamente para que no se pueda volver a enlazar el anuncio.
 */
describe('Reputación — el enlace del aviso de «valora tu trato» (A1) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let listings: ListingsService;
  let addSpy: jest.SpyInstance;

  let vendedor: { id: string; slug: string };
  let comprador: { id: string; slug: string };
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    listings = app.get(ListingsService);

    // La cola QUE EL SERVICIO TIENE INYECTADA, no la del `app.get` global: varios
    // módulos registran la misma cola por nombre y cada registro crea su propia
    // instancia, así que el global devuelve la primera que encuentra — que no es
    // ésta. Con la instancia equivocada el espía no vería nada. (Molde exacto de
    // `moderation-notifications.e2e-spec.ts`.)
    const queue = (
      listings as unknown as { notificationQueue: { add: (...a: unknown[]) => unknown } }
    ).notificationQueue;
    addSpy = jest.spyOn(queue, 'add').mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
    addSpy.mockRestore();
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    addSpy.mockClear();
    vendedor = await crearUsuario('vend');
    comprador = await crearUsuario('comp');
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  async function crearUsuario(prefijo: string) {
    const id = randomUUID().slice(0, 8);
    const u = await prisma.user.create({
      data: {
        email: `rre-${prefijo}-${id}@test.local`,
        name: `Rre ${prefijo} ${id}`,
        slug: `rre-${prefijo}-${id}`,
      },
    });
    return { id: u.id, slug: u.slug };
  }

  async function anuncioActivo() {
    return prisma.listing.create({
      data: {
        title: 'Bici de carretera',
        slug: `rre-${randomUUID().slice(0, 8)}`,
        description: 'descripción',
        price: 100,
        type: 'PRODUCT',
        sellerId: vendedor.id,
        categoryId,
        status: 'ACTIVE',
      },
    });
  }

  const correos = () =>
    addSpy.mock.calls
      .filter((c) => c[0] === NOTIFICATION_JOB.SEND_REVIEW_REQUEST_EMAIL)
      .map((c) => c[1] as Record<string, unknown>);

  it('el anuncio queda SOLD: el enlace no puede depender de su ficha pública', async () => {
    const anuncio = await anuncioActivo();

    await listings.closeDeal(anuncio.id, vendedor.id, { buyerId: comprador.id });

    // La premisa del defecto, fijada aquí para que no se pueda perder de vista:
    // si esto dejara de ser SOLD, el enlace viejo habría dejado de romperse.
    const despues = await prisma.listing.findUniqueOrThrow({ where: { id: anuncio.id } });
    expect(despues.status).toBe('SOLD');
  });

  it('el correo NO lleva el slug del anuncio: no se puede volver a enlazar la ficha', async () => {
    const anuncio = await anuncioActivo();

    await listings.closeDeal(anuncio.id, vendedor.id, { buyerId: comprador.id });

    const enviados = correos();
    expect(enviados).toHaveLength(2); // uno por parte

    for (const payload of enviados) {
      expect(payload).not.toHaveProperty('listingSlug');
      expect(Object.values(payload)).not.toContain(anuncio.slug);
    }
  });

  it('el correo lleva al perfil del OTRO, con el deep-link de valoración', async () => {
    const anuncio = await anuncioActivo();

    await listings.closeDeal(anuncio.id, vendedor.id, { buyerId: comprador.id });

    const alVendedor = correos().find((c) => c.otherUserId === comprador.id);
    const alComprador = correos().find((c) => c.otherUserId === vendedor.id);

    // Cada uno recibe los datos para valorar A LA OTRA PARTE, no a sí mismo.
    expect(alVendedor).toBeDefined();
    expect(alVendedor!.otherUserSlug).toBe(comprador.slug);
    expect(alVendedor!.listingId).toBe(anuncio.id);

    expect(alComprador).toBeDefined();
    expect(alComprador!.otherUserSlug).toBe(vendedor.slug);
    expect(alComprador!.listingId).toBe(anuncio.id);
  });

  it('los dos canales apuntan al mismo sitio (§A1.3)', async () => {
    const anuncio = await anuncioActivo();

    await listings.closeDeal(anuncio.id, vendedor.id, { buyerId: comprador.id });

    const avisos = await prisma.notification.findMany({
      where: { userId: vendedor.id, type: 'REVIEW_REQUEST' },
    });
    expect(avisos).toHaveLength(1);
    const inApp = avisos[0].data as Record<string, unknown>;
    const porCorreo = correos().find((c) => c.otherUserId === comprador.id)!;

    // El front arma `/vendedor/{otherUserSlug}?valorar={listingId}&target={otherUserId}`
    // con el snapshot; el processor arma la misma URL con el payload. Que los tres
    // campos coincidan es lo que hace que no puedan volver a divergir.
    expect(porCorreo.otherUserSlug).toBe(inApp.otherUserSlug);
    expect(porCorreo.otherUserId).toBe(inApp.otherUserId);
    expect(porCorreo.listingId).toBe(inApp.listingId);
  });
});
