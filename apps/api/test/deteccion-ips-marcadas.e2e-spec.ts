/**
 * A1 — LA LISTA DE IPs MARCADAS, y la retirada del detector de IPs sobre texto.
 *
 * Tres barreras:
 *
 *  1. **AVISA, y NADA MÁS.** Una IP marcada hace que el anuncio y el usuario que vienen de
 *     ella salgan señalados, y **no les pasa nada más**: el anuncio sigue ACTIVE y el usuario
 *     sigue sin `requiresReview`. La máquina señala; la persona marca.
 *
 *  2. **LA CARACTERÍSTICA: se puede rectificar.** Quitar una IP de la lista **des-marca al
 *     instante, en todo el histórico**, porque la coincidencia se DERIVA y no se guarda. Es
 *     la razón real de derivar —no el rendimiento—: en una lista de vigilancia, poder
 *     deshacer un error es la diferencia entre una herramienta y una condena.
 *
 *  3. **El detector de IPs sobre texto, retirado.** Una IP escrita en una descripción ya no
 *     genera ninguna detección, y sus filas viejas se limpiaron en la migración.
 *
 * Y la coincidencia es **EXACTA**: `10.0.0.1` no casa `110.0.0.10`. Misma barrera que 5b, por
 * la misma razón — en una investigación de multicuenta eso es señalar a quien no es.
 *
 * Ver `docs/diseno-listas-ip-telefono.md` §A.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

const IPS = 'flaggedIps';
const IP_MALA = '10.0.0.5';
const IP_PARECIDA = '110.0.0.50';

describe('A1 — IPs marcadas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let sellerId: string;
  let adminToken: string;
  let categoryId: string;
  let ipsOriginal: unknown;

  const server = () => app.getHttpServer();

  let n = 0;
  const crearAnuncio = (lastOwnerIp: string | null, description = 'Un anuncio normal.') =>
    prisma.listing.create({
      data: {
        title: `IPs ${++n}`,
        slug: `ips-${n}-${Date.now()}`,
        description,
        price: 10,
        type: 'PRODUCT',
        status: 'ACTIVE',
        sellerId,
        categoryId,
        lastOwnerIp,
      },
    });

  const crearUsuario = (sufijo: string, lastLoginIp: string | null) =>
    bcrypt.hash('Test1234!', 4).then((passwordHash) =>
      prisma.user.create({
        data: {
          email: `ips-${sufijo}@example.com`,
          name: `IPs ${sufijo}`,
          slug: `ips-${sufijo}`,
          passwordHash,
          emailVerified: true,
          lastLoginIp,
        },
      }),
    );

  async function fijarLista(ips: string[]) {
    await prisma.setting.upsert({
      where: { key: IPS },
      create: { key: IPS, value: ips as never },
      update: { value: ips as never },
    });
  }

  const fichaAnuncio = (id: string) =>
    request(server())
      .get(`/api/admin/listings/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .then((r) => r.body);

  const fichaUsuario = (id: string) =>
    request(server())
      .get(`/api/admin/users/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .then((r) => r.body);

  const listaAnuncios = (qs = '') =>
    request(server())
      .get(`/api/admin/listings?perPage=100&${qs}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .then((r) => r.body.items as { id: string; ipFlagged: boolean }[]);

  const listaUsuarios = (qs = '') =>
    request(server())
      .get(`/api/admin/users?perPage=100&${qs}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .then((r) => r.body.items as { id: string; ipFlagged: boolean }[]);

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    prisma = new PrismaClient();
    await cleanDb(prisma);

    ipsOriginal = (await prisma.setting.findUnique({ where: { key: IPS } }))?.value ?? null;

    const passwordHash = await bcrypt.hash('Test1234!', 10);
    const [seller] = await Promise.all([
      prisma.user.create({
        data: {
          email: 'ips-seller@example.com', name: 'IPs Seller', slug: 'ips-seller',
          passwordHash, emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'ips-admin@example.com', name: 'IPs Admin', slug: 'ips-admin',
          passwordHash, emailVerified: true, role: 'ADMIN',
        },
      }),
    ]);
    sellerId = seller.id;

    categoryId = (
      await prisma.category.create({
        data: { name: 'IPs Cat', slug: 'ips-cat', attributeSchema: [] },
      })
    ).id;

    adminToken = (
      await request(server())
        .post('/api/auth/admin-login')
        .send({ email: 'ips-admin@example.com', password: 'Test1234!' })
    ).body.accessToken as string;
  }, 60_000);

  afterAll(async () => {
    if (ipsOriginal === null) {
      await prisma.setting.deleteMany({ where: { key: IPS } });
    } else {
      await prisma.setting.upsert({
        where: { key: IPS },
        create: { key: IPS, value: ipsOriginal as never },
        update: { value: ipsOriginal as never },
      });
    }
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 1 — avisa, y nada más
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 1: una IP marcada señala al anuncio Y al usuario, y NO les pasa nada más', async () => {
    await fijarLista([IP_MALA]);
    const anuncio = await crearAnuncio(IP_MALA);
    const usuario = await crearUsuario('marcado', IP_MALA);

    // Señalados, los dos.
    expect((await fichaAnuncio(anuncio.id)).ipFlagged).toBe(true);
    expect((await fichaUsuario(usuario.id)).ipFlagged).toBe(true);

    // Y LA MITAD QUE IMPORTA: no les ha pasado NADA. Con sólo la primera, una lista que
    // además despublicara pasaría este test.
    const filaAnuncio = await prisma.listing.findUniqueOrThrow({ where: { id: anuncio.id } });
    expect(filaAnuncio.status).toBe('ACTIVE');
    // Y tampoco los ejes de P1: el aviso es su propia cosa.
    expect(filaAnuncio.triage).toBe('NEW');
    expect(filaAnuncio.watched).toBe(false);

    // El usuario NO se marca solo. `requiresReview` lo pone una persona y se audita con
    // nombre; si el sistema lo escribiera, un moderador que lo quitara se lo encontraría
    // puesto otra vez en el siguiente login — y no hay actor «sistema» al que apuntárselo.
    const filaUsuario = await prisma.user.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(filaUsuario.requiresReview).toBe(false);
    expect(filaUsuario.status).toBe('ACTIVE');
  });

  it('y quien NO viene de una IP marcada no sale señalado', async () => {
    await fijarLista([IP_MALA]);
    const limpio = await crearAnuncio('192.168.7.7');
    const sinIp = await crearAnuncio(null);

    expect((await fichaAnuncio(limpio.id)).ipFlagged).toBe(false);
    // Sin IP anotada no hay coincidencia posible: `null` no está marcado, está en blanco.
    expect((await fichaAnuncio(sinIp.id)).ipFlagged).toBe(false);
  });

  it('LA COINCIDENCIA ES EXACTA: 10.0.0.5 no señala a 110.0.0.50', async () => {
    // La barrera de 5b, aplicada a la lista. Un `contains` aquí no es un falso positivo
    // cualquiera — es señalar a quien no es, en una investigación de multicuenta.
    await fijarLista([IP_MALA]);
    const parecido = await crearAnuncio(IP_PARECIDA);
    const usuarioParecido = await crearUsuario('parecido', IP_PARECIDA);

    expect((await fichaAnuncio(parecido.id)).ipFlagged).toBe(false);
    expect((await fichaUsuario(usuarioParecido.id)).ipFlagged).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 2 — LA CARACTERÍSTICA: rectificable al instante
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 2 (LA CARACTERÍSTICA): quitar la IP de la lista DES-MARCA al instante', async () => {
    await fijarLista([IP_MALA]);
    const anuncio = await crearAnuncio(IP_MALA);
    const usuario = await crearUsuario('rectificado', IP_MALA);

    expect((await fichaAnuncio(anuncio.id)).ipFlagged).toBe(true);
    expect((await fichaUsuario(usuario.id)).ipFlagged).toBe(true);

    // Se quita del ajuste. NO SE TOCA NADA MÁS: ni el anuncio, ni el usuario, ni ninguna
    // tabla de detecciones — porque no hay ninguna.
    await fijarLista([]);

    // Y ya no están señalados. Es la prueba de que se DERIVA: con filas persistidas seguirían
    // marcados hasta que alguien las barriera, y hasta entonces el backoffice señalaría a
    // gente por una regla que ya nadie mantiene.
    expect((await fichaAnuncio(anuncio.id)).ipFlagged).toBe(false);
    expect((await fichaUsuario(usuario.id)).ipFlagged).toBe(false);
    expect(
      (await listaAnuncios('ipFlagged=true')).map((l) => l.id),
    ).not.toContain(anuncio.id);
  });

  it('y volver a ponerla los señala otra vez, sin haber tocado ninguna fila', async () => {
    const anuncio = await crearAnuncio(IP_MALA);
    await fijarLista([]);
    expect((await fichaAnuncio(anuncio.id)).ipFlagged).toBe(false);
    await fijarLista([IP_MALA]);
    expect((await fichaAnuncio(anuncio.id)).ipFlagged).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // El filtro — sin él, el aviso no se lee
  // ───────────────────────────────────────────────────────────────────────────

  it('las dos listas filtran por «viene de una IP marcada»', async () => {
    await fijarLista([IP_MALA]);
    const marcado = await crearAnuncio(IP_MALA);
    const limpio = await crearAnuncio('8.8.8.8');
    const uMarcado = await crearUsuario('filtro-si', IP_MALA);
    const uLimpio = await crearUsuario('filtro-no', '8.8.8.8');

    const anunciosMarcados = (await listaAnuncios('ipFlagged=true')).map((l) => l.id);
    expect(anunciosMarcados).toContain(marcado.id);
    expect(anunciosMarcados).not.toContain(limpio.id);

    const usuariosMarcados = (await listaUsuarios('ipFlagged=true')).map((u) => u.id);
    expect(usuariosMarcados).toContain(uMarcado.id);
    expect(usuariosMarcados).not.toContain(uLimpio.id);
  });

  it('el `false` trae también a los que NO tienen IP anotada', async () => {
    // En SQL, `NULL NOT IN (…)` es NULL, así que un `notIn` a secas los habría excluido a
    // todos — y un anuncio sin IP es justamente uno que no viene de ninguna marcada. Es un
    // fallo que no da error: la lista sale más corta y parece que hay menos.
    await fijarLista([IP_MALA]);
    const sinIp = await crearAnuncio(null);
    const marcado = await crearAnuncio(IP_MALA);

    const limpios = (await listaAnuncios('ipFlagged=false')).map((l) => l.id);
    expect(limpios).toContain(sinIp.id);
    expect(limpios).not.toContain(marcado.id);
  });

  it('la lista trae el aviso ya derivado, sin enseñar la IP del anuncio', async () => {
    await fijarLista([IP_MALA]);
    const marcado = await crearAnuncio(IP_MALA);
    const fila = (await listaAnuncios()).find((l) => l.id === marcado.id);
    expect(fila?.ipFlagged).toBe(true);
    // La lista de anuncios dice SI está marcada, no CUÁL es. La IP en claro vive en la
    // ficha, con su aviso RC.1 al lado.
    expect(fila).not.toHaveProperty('lastOwnerIp');
  });

  it('un ajuste roto no señala a nadie', async () => {
    // Una entrada en blanco es lo peligroso: sin filtrarla acabaría en el conjunto y
    // marcaría a TODO el que no tiene IP anotada, que son casi todos.
    await fijarLista(['', '   ']);
    const sinIp = await crearAnuncio(null);
    const conIp = await crearAnuncio(IP_MALA);
    expect((await fichaAnuncio(sinIp.id)).ipFlagged).toBe(false);
    expect((await fichaAnuncio(conIp.id)).ipFlagged).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BARRERA 3 — el detector de IPs sobre texto, retirado
  // ───────────────────────────────────────────────────────────────────────────

  it('BARRERA 3: una IP en la DESCRIPCIÓN ya no genera ninguna detección', async () => {
    // Es lo que se retiró: la heurística que disparaba con cualquier IP escrita, incluida la
    // del anuncio de router que documenta la suya. Lo que quedó es la lista, que mira la
    // última IP y no el texto.
    const anuncio = await crearAnuncio(null, 'Se configura entrando en 192.168.1.1.');
    await request(server())
      .patch(`/api/admin/listings/${anuncio.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        description: 'Se configura entrando en 192.168.1.1.',
        reason: 'Forzar una pasada del motor sobre el texto',
      })
      .expect(200);

    expect(await prisma.listingDetection.count({ where: { listingId: anuncio.id } })).toBe(0);
  });

  it('y el enum ya no admite el detector retirado', async () => {
    // La migración recreó el tipo sin `IP`. Intentar escribir una fila con ese valor tiene
    // que reventar: es la prueba de que no quedan filas viejas posibles ni nuevas.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "ListingDetection" (id, "listingId", detector, field, match)
         VALUES ('x', 'y', 'IP', 'TITLE', 'z')`,
      ),
    ).rejects.toThrow();
  });
});
