/**
 * RESIDUO BANNED — EL BAN, ATADO AL CICLO DE VIDA DE LOS ANUNCIOS.
 *
 * Lo que se cierra: hasta aquí banear era una transición de `User.status` a secas.
 * Un `BANNED` seguía con sus anuncios `ACTIVE`, indexados y con ficha pública —C3
 * escondió su perfil y dejó esto anotado como residuo consciente—, de modo que **la
 * sanción grave ocultaba MENOS que el archivado voluntario**, que sí los pausa (C2).
 *
 * Las cuatro barreras:
 *   1. BANEAR PAUSA — `ACTIVE`/`RESERVED` → `PAUSED`, fuera del índice, sin ficha
 *      (404) y sin ocupar cuota. Exactamente lo que hace el archivado.
 *   2. REINSTAURAR **NO** RESTAURA — los anuncios siguen `PAUSED`; el usuario los
 *      reactiva él mismo. Es la decisión: levantar el ban devuelve el acceso, no la
 *      visibilidad. Aquí este cuerpo NO es el espejo de `unarchive()`.
 *   3. EL ORIGEN NO SE CONFUNDE — `ListingPauseOrigin` distingue quién pausó. El ban
 *      no re-pausa lo que ya pausó el archivado, y desarchivar no reactiva lo que
 *      pausó el ban. Es la barrera que justifica el enum frente a dos booleanos.
 *   4. UN SOLO LECTOR — el archivado y el ban pausan con el MISMO `ListingPauseService`.
 *      Se comprueba sobre el código fuente, que es donde vive el defecto.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import {
  ListingPauseOrigin,
  ListingStatus,
  Prisma,
  PrismaClient,
  UserStatus,
} from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { waitForIndex, waitForRemoval } from './helpers/meili';
import { SearchService, INDEX_INCLUDE } from 'src/modules/search/search.service';

const INDEX_NAME = process.env.MEILI_INDEX_NAME ?? 'listings_test';

describe('Residuo BANNED — banear pausa los anuncios (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  let search: SearchService;
  let adminToken: string;
  let categoryId: string;
  let hash: string;

  const PASSWORD = 'Test1234!';
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    meili = buildMeiliClient();
    await resetMeili(meili);
    search = app.get(SearchService);
    hash = await bcrypt.hash(PASSWORD, 4);

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = cat.id;

    // Banear y reinstaurar son ADMIN, no MODERATOR: son la sanción grave y su
    // levantamiento (`admin.controller.ts`, @MinRole(ADMIN) de la clase).
    await prisma.user.create({
      data: {
        email: 'rb-admin@example.com',
        name: 'RB Admin',
        slug: 'rb-admin',
        passwordHash: hash,
        emailVerified: true,
        role: 'ADMIN',
      },
    });
    adminToken = (
      await request(server())
        .post('/api/auth/admin-login')
        .send({ email: 'rb-admin@example.com', password: PASSWORD })
        .expect(200)
    ).body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  let n = 0;

  async function crearUsuario(marca: string, status: UserStatus = 'ACTIVE') {
    n += 1;
    return prisma.user.create({
      data: {
        email: `rb-${marca}-${n}@example.com`,
        name: `RB ${marca}`,
        slug: `rb-${marca}-${n}`,
        passwordHash: hash,
        emailVerified: true,
        status,
      },
    });
  }

  async function crearAnuncio(sellerId: string, status: ListingStatus, marca: string) {
    n += 1;
    return prisma.listing.create({
      data: {
        title: `RB ${marca}`,
        slug: `rb-anuncio-${marca}-${n}`,
        description: 'descripción de prueba con longitud suficiente',
        price: new Prisma.Decimal('30.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status,
        sellerId,
        categoryId,
        publishedAt: new Date(),
      },
    });
  }

  /** Mete el anuncio en el índice sin depender de la cola: lo que se quiere medir
   *  aquí es la SALIDA del índice al banear, no el camino de publicación. */
  async function indexar(listingId: string) {
    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      include: INDEX_INCLUDE,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await search.indexListing(listing as any);
    await waitForIndex(meili, INDEX_NAME, listingId);
  }

  const banear = (id: string) =>
    request(server()).patch(`/api/admin/users/${id}/ban`).set('Authorization', `Bearer ${adminToken}`);

  const reinstaurar = (id: string) =>
    request(server())
      .patch(`/api/admin/users/${id}/reinstate`)
      .set('Authorization', `Bearer ${adminToken}`);

  const archivar = (id: string) =>
    request(server())
      .patch(`/api/admin/users/${id}/archive`)
      .set('Authorization', `Bearer ${adminToken}`);

  const desarchivar = (id: string) =>
    request(server())
      .patch(`/api/admin/users/${id}/unarchive`)
      .set('Authorization', `Bearer ${adminToken}`);

  const leer = (id: string) => prisma.listing.findUniqueOrThrow({ where: { id } });

  // ═════════════════════════════════════════════════════════════════════════════
  //  BARRERA 1 — banear pausa, oculta y libera cuota
  // ═════════════════════════════════════════════════════════════════════════════

  describe('Barrera 1 — banear saca los anuncios del escaparate', () => {
    it('los ACTIVE y RESERVED pasan a PAUSED con origen BAN; DRAFT, PENDING_REVIEW y SOLD no se tocan', async () => {
      const user = await crearUsuario('pausa');
      const activo = await crearAnuncio(user.id, 'ACTIVE', 'activo');
      const reservado = await crearAnuncio(user.id, 'RESERVED', 'reservado');
      const borrador = await crearAnuncio(user.id, 'DRAFT', 'borrador');
      const enRevision = await crearAnuncio(user.id, 'PENDING_REVIEW', 'revision');
      const vendido = await crearAnuncio(user.id, 'SOLD', 'vendido');

      const res = await banear(user.id).expect(200);
      expect(res.body.status).toBe(UserStatus.BANNED);
      expect(res.body.anunciosPausados).toBe(2);

      // Lo que SE VE: pausado y con el origen escrito.
      for (const l of [activo, reservado]) {
        const tras = await leer(l.id);
        expect(tras.status).toBe(ListingStatus.PAUSED);
        expect(tras.pausedByAccountReason).toBe(ListingPauseOrigin.BAN);
      }

      // Lo que NO se ve, intacto — mismo criterio que el archivado: un DRAFT o un
      // PENDING_REVIEW no está indexado ni tiene ficha, así que no hay nada que
      // ocultar; un SOLD ya salió del escaparate solo.
      expect((await leer(borrador.id)).status).toBe(ListingStatus.DRAFT);
      expect((await leer(enRevision.id)).status).toBe(ListingStatus.PENDING_REVIEW);
      expect((await leer(vendido.id)).status).toBe(ListingStatus.SOLD);
      for (const l of [borrador, enRevision, vendido]) {
        expect((await leer(l.id)).pausedByAccountReason).toBeNull();
      }
    });

    it('el anuncio sale del índice de Meilisearch', async () => {
      const user = await crearUsuario('indice');
      const anuncio = await crearAnuncio(user.id, 'ACTIVE', 'indice');
      await indexar(anuncio.id);

      await banear(user.id).expect(200);

      // Sólo se indexan los ACTIVE: al pasar a PAUSED, el job de reindexado que
      // encola el pausado lo retira. Es el mismo camino que usa el archivado.
      await waitForRemoval(meili, INDEX_NAME, anuncio.id);
    });

    it('la ficha del anuncio deja de servirse (404), que es lo que el residuo dejaba abierto', async () => {
      const user = await crearUsuario('ficha');
      const anuncio = await crearAnuncio(user.id, 'ACTIVE', 'ficha');

      // ANTES del ban la ficha existe: sin esto, el 404 de después no probaría nada
      // (podría ser un slug que nunca sirvió).
      await request(server()).get(`/api/listings/${anuncio.slug}`).expect(200);

      await banear(user.id).expect(200);

      // `findBySlug` exige `status === 'ACTIVE'`, así que pausar basta para cerrar
      // la ficha — no hace falta que la ficha aprenda a mirar al vendedor.
      await request(server()).get(`/api/listings/${anuncio.slug}`).expect(404);
    });

    it('un anuncio pausado por el ban NO cuenta para la cuota de activos', async () => {
      const user = await crearUsuario('cuota');
      await crearAnuncio(user.id, 'ACTIVE', 'cuota');

      await banear(user.id).expect(200);

      // La cuota cuenta `status: ACTIVE`; pausado no lo está. Se comprueba sobre la
      // base porque es lo que mira la regla.
      expect(
        await prisma.listing.count({ where: { sellerId: user.id, status: ListingStatus.ACTIVE } }),
      ).toBe(0);
    });

    it('banear a quien no tiene anuncios vivos sigue funcionando (y no inventa ninguno)', async () => {
      const user = await crearUsuario('sin-anuncios');
      const res = await banear(user.id).expect(200);
      expect(res.body.status).toBe(UserStatus.BANNED);
      expect(res.body.anunciosPausados).toBe(0);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  BARRERA 2 — reinstaurar NO restaura
  // ═════════════════════════════════════════════════════════════════════════════

  describe('Barrera 2 — reinstaurar devuelve el acceso, no la visibilidad', () => {
    /**
     * LA DECISIÓN DEL CUERPO. Si reinstaurar reactivara los anuncios, este método
     * sería el espejo de `unarchive()` — y no lo es: un archivado es un paréntesis
     * que el usuario pidió y se le devuelve entero; una sanción no se deshace sola.
     */
    it('tras reinstaurar, los anuncios siguen PAUSED — no vuelven a ACTIVE solos', async () => {
      const user = await crearUsuario('no-restaura');
      const uno = await crearAnuncio(user.id, 'ACTIVE', 'uno');
      const dos = await crearAnuncio(user.id, 'RESERVED', 'dos');

      await banear(user.id).expect(200);
      const res = await reinstaurar(user.id).expect(200);

      expect(res.body.status).toBe(UserStatus.ACTIVE);
      // El número dice cuántos se quedan pausados: es lo que el backoffice necesita
      // para poder contárselo a quien pulsa el botón.
      expect(res.body.anunciosSinReactivar).toBe(2);

      for (const l of [uno, dos]) {
        expect((await leer(l.id)).status).toBe(ListingStatus.PAUSED);
      }
      expect(
        await prisma.listing.count({ where: { sellerId: user.id, status: ListingStatus.ACTIVE } }),
      ).toBe(0);
    });

    it('la marca BAN se limpia al reinstaurar: quedan como pausados normales', async () => {
      const user = await crearUsuario('marca-muerta');
      const anuncio = await crearAnuncio(user.id, 'ACTIVE', 'marca');

      await banear(user.id).expect(200);
      expect((await leer(anuncio.id)).pausedByAccountReason).toBe(ListingPauseOrigin.BAN);

      await reinstaurar(user.id).expect(200);

      // Sin limpiarla quedaría una marca que ya no es cierta —la cuenta no está
      // sancionada— y que el siguiente lector tendría que aprender a ignorar.
      const tras = await leer(anuncio.id);
      expect(tras.status).toBe(ListingStatus.PAUSED);
      expect(tras.pausedByAccountReason).toBeNull();
    });

    it('el usuario reinstaurado los reactiva ÉL: reactivar su anuncio funciona', async () => {
      const user = await crearUsuario('reactiva-el');
      const anuncio = await crearAnuncio(user.id, 'ACTIVE', 'reactiva');

      await banear(user.id).expect(200);
      await reinstaurar(user.id).expect(200);

      // Puede volver a entrar (el ban se levantó) …
      const token = (
        await request(server())
          .post('/api/auth/login')
          .send({ email: user.email, password: PASSWORD })
          .expect(200)
      ).body.accessToken as string;

      // … y reactivar lo suyo desde su panel, que es la mitad que este cuerpo le
      // deja a él. Sin este caso, «no se restaura» podría estar escondiendo un
      // anuncio que ya no se puede recuperar por ningún camino.
      await request(server())
        .post(`/api/listings/${anuncio.id}/reactivate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((await leer(anuncio.id)).status).toBe(ListingStatus.ACTIVE);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  BARRERA 3 — el origen no se confunde
  // ═════════════════════════════════════════════════════════════════════════════

  describe('Barrera 3 — el ban y el archivado no se pisan', () => {
    /**
     * EL CASO QUE OBLIGA AL ENUM, primera mitad: archivado y DESPUÉS baneado.
     *
     * Sus anuncios ya salieron del escaparate con origen `ARCHIVE`. Si el ban los
     * re-pausara marcándolos `BAN`, les robaría el billete de vuelta que el
     * desarchivado tiene que honrar. No hace falta un `if`: el ban sólo mira
     * `ACTIVE`/`RESERVED`, y éstos ya están `PAUSED`.
     */
    it('archivado y luego baneado: los ya pausados CONSERVAN el origen ARCHIVE', async () => {
      const user = await crearUsuario('archivado-luego-baneado');
      const delArchivado = await crearAnuncio(user.id, 'ACTIVE', 'del-archivado');
      const delDueno = await crearAnuncio(user.id, 'PAUSED', 'del-dueno');

      await archivar(user.id).expect(200);
      expect((await leer(delArchivado.id)).pausedByAccountReason).toBe(ListingPauseOrigin.ARCHIVE);
      expect((await leer(delDueno.id)).pausedByAccountReason).toBeNull();

      const res = await banear(user.id).expect(200);
      expect(res.body.anunciosPausados).toBe(0); // no había nada vivo que pausar

      // Ni el ban se apropia de lo del archivado, ni reclama lo que pausó el dueño.
      expect((await leer(delArchivado.id)).pausedByAccountReason).toBe(ListingPauseOrigin.ARCHIVE);
      expect((await leer(delDueno.id)).pausedByAccountReason).toBeNull();
    });

    /**
     * EL CASO QUE OBLIGA AL ENUM, segunda mitad, y el que un booleano compartido
     * habría roto en silencio: baneado y DESPUÉS archivado (§1.1 — un baneado
     * conserva su derecho al olvido, y el staff archiva por él).
     *
     * Al desarchivar, `statusBeforeArchive` lo devuelve a `BANNED`. Si el
     * desarchivado reactivara «todo lo marcado», un usuario BANEADO se despertaría
     * con sus anuncios `ACTIVE` — exactamente el agujero que el residuo cerró.
     */
    it('baneado y luego archivado: desarchivar NO reactiva lo que pausó el ban', async () => {
      const user = await crearUsuario('baneado-luego-archivado');
      const delBan = await crearAnuncio(user.id, 'ACTIVE', 'del-ban');

      await banear(user.id).expect(200);
      expect((await leer(delBan.id)).pausedByAccountReason).toBe(ListingPauseOrigin.BAN);

      await archivar(user.id).expect(200);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).statusBeforeArchive,
      ).toBe(UserStatus.BANNED);

      const res = await desarchivar(user.id).expect(200);
      expect(res.body.status).toBe(UserStatus.BANNED); // el ban no se ha lavado
      expect(res.body.anunciosReactivados).toBe(0);

      // Y su anuncio sigue pausado, con su marca de ban intacta.
      const tras = await leer(delBan.id);
      expect(tras.status).toBe(ListingStatus.PAUSED);
      expect(tras.pausedByAccountReason).toBe(ListingPauseOrigin.BAN);
    });

    it('desarchivar sí reactiva lo suyo aunque haya un anuncio con marca BAN al lado', async () => {
      // Los dos orígenes conviviendo en el mismo vendedor: la mezcla que un solo
      // booleano no sabría separar.
      const user = await crearUsuario('dos-origenes');
      const delBan = await crearAnuncio(user.id, 'ACTIVE', 'mezcla-ban');

      await banear(user.id).expect(200);
      await reinstaurar(user.id).expect(200);
      // Tras reinstaurar la marca se limpió; se re-marca a mano para construir el
      // estado mixto sin depender de un camino que el producto no ofrece.
      await prisma.listing.update({
        where: { id: delBan.id },
        data: { pausedByAccountReason: ListingPauseOrigin.BAN },
      });

      const delArchivado = await crearAnuncio(user.id, 'ACTIVE', 'mezcla-archivo');
      await archivar(user.id).expect(200);
      await desarchivar(user.id).expect(200);

      expect((await leer(delArchivado.id)).status).toBe(ListingStatus.ACTIVE);
      expect((await leer(delBan.id)).status).toBe(ListingStatus.PAUSED);
      expect((await leer(delBan.id)).pausedByAccountReason).toBe(ListingPauseOrigin.BAN);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  //  BARRERA 4 — un solo lector
  // ═════════════════════════════════════════════════════════════════════════════

  describe('Barrera 4 — el archivado y el ban pausan con el MISMO código', () => {
    /**
     * LA BARRERA DE ORIGEN, sobre el código fuente y no sobre la conducta: dos copias
     * de «pausar los anuncios de un usuario» pasarían las tres barreras de arriba el
     * día que se escriben y divergirían la primera vez que una de las dos cambie —
     * que es justo el defecto que no se ve. Molde de la barrera de migraciones de
     * `ultima-ip-orden.e2e-spec.ts`: mira los FICHEROS, que es donde vive.
     */
    it('en TODO `src` hay UN solo fichero que escribe la marca de origen', () => {
      const src = join(__dirname, '..', 'src');

      const ficheros: string[] = [];
      const recorrer = (dir: string) => {
        for (const entrada of readdirSync(dir, { withFileTypes: true })) {
          const ruta = join(dir, entrada.name);
          if (entrada.isDirectory()) recorrer(ruta);
          else if (entrada.name.endsWith('.ts') && !entrada.name.endsWith('.spec.ts')) {
            ficheros.push(ruta);
          }
        }
      };
      recorrer(src);
      // Red del propio test: si el recorrido dejara de encontrar ficheros, esto
      // pasaría en verde afirmando que ha revisado el árbol entero.
      expect(ficheros.length).toBeGreaterThan(100);

      /**
       * Un ESCRITOR de la marca: un `data: { … pausedByAccountReason: <valor> }` con
       * un valor que no sea `null`. Se CAPTURA el valor y se compara en JavaScript en
       * vez de excluirlo con un `(?!null)` dentro del patrón: un lookahead detrás de
       * `\s*` no sirve de nada porque el motor retrocede el espacio y lo esquiva —
       * pasó al escribir esta barrera, y salía verde de mentira al revés.
       *
       * Limpiar la marca (ponerla a `null`) SÍ puede hacerlo cada quien: restaurar es
       * justo la mitad que el archivado y el ban no comparten.
       */
      const ESCRITURA = /data:\s*\{[^}]*?pausedByAccountReason:\s*([A-Za-z_$][\w$.]*)/g;

      const escritores = ficheros
        .filter((f) =>
          [...readFileSync(f, 'utf8').matchAll(ESCRITURA)].some(([, valor]) => valor !== 'null'),
        )
        .map((f) => f.slice(src.length + 1).replace(/\\/g, '/'));

      expect(escritores).toEqual(['modules/listing-pause/listing-pause.service.ts']);
    });

    it('los dos llamantes delegan en el servicio compartido', () => {
      const src = join(__dirname, '..', 'src');
      for (const fichero of [
        join(src, 'modules', 'account-archive', 'account-archive.service.ts'),
        join(src, 'modules', 'admin', 'admin.service.ts'),
      ]) {
        expect(readFileSync(fichero, 'utf8')).toContain('pauseListingsForUser');
      }
    });

    it('el servicio compartido existe y declara los dos orígenes como PAUSABLES', async () => {
      const { ListingPauseService } = await import('src/modules/listing-pause/listing-pause.service');
      // La lista de estados pausables vive en UN sitio: si alguien añadiera aquí un
      // `DRAFT`, lo heredarían los dos caminos a la vez — que es la propiedad que se
      // quiere, y la razón de que la constante no esté duplicada.
      expect(ListingPauseService.PAUSABLES).toEqual([ListingStatus.ACTIVE, ListingStatus.RESERVED]);
    });
  });
});
