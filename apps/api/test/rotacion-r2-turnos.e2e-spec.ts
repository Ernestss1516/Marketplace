/**
 * ROTACIÓN DE DESTACADOS — R2: el bloque deja de estar congelado (e2e).
 *
 * EL DEFECTO QUE CIERRA. El bloque «Promocionados» eran «los 4 primeros del orden pedido», y
 * con el orden por defecto de una categoría esa clave es `publishedAt`, que no cambia nunca:
 * los mismos cuatro para siempre. Quien destacaba un anuncio antiguo caía bajo el corte desde
 * el primer segundo del periodo que había pagado (auditoría, hallazgo H5). Ahora los
 * destacados se TURNAN por ventanas de 15 min.
 *
 * CÓMO SE COMPRUEBA QUE «TODOS SALEN». La promesa se demuestra en dos mitades que encajan:
 *  · aquí, con el reloj gobernado, se ven ventanas consecutivas devolviendo grupos DISTINTOS
 *    y DISJUNTOS cuya unión es el anillo entero;
 *  · y en `featured-rotation.spec.ts`, que un ciclo visita cada grupo exactamente una vez.
 * Juntas dan la garantía: cada destacado sale un grupo por ciclo, ni más ni menos.
 *
 * EL RELOJ SE GOBIERNA, NO SE ESPERA. `Date.now` se sustituye durante la petición y se
 * restaura siempre: un test que esperase 15 minutos reales no sería un test. Los instantes se
 * eligen ALINEADOS al epoch, que es como el código deriva la ventana.
 *
 * EL ORÁCULO ES INDEPENDIENTE: lo que el bloque debería traer se pregunta a Meilisearch
 * directamente, con la consulta del anillo, sin pasar por el controlador. Si el controlador se
 * inventa el orden o pierde un filtro, los dos lados dejan de coincidir.
 *
 * LAS MUTACIONES QUE ESTO MATA:
 *  · usar `dto.sort` en vez del orden del anillo → el bloque cambiaría al cambiar la
 *    ordenación pedida, y bajo la de por defecto volvería a congelarse;
 *  · quitar la vigencia → un destacado caducado seguiría robando turno hasta 23 h;
 *  · lanzar la segunda consulta con N ≤ 4 → coste donde no hay problema;
 *  · rotar también la lista o el conteo → la Política C se rompería.
 */

import { INestApplication } from '@nestjs/common';
import { EntitlementType, ListingStatus, PrismaClient, Prisma } from '@prisma/client';
import { MeiliSearch } from 'meilisearch';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { buildMeiliClient, cleanDb, resetMeili } from './helpers/db';
import { waitForDocumentWhere } from './helpers/meili';
import { SearchService, INDEX_INCLUDE } from 'src/modules/search/search.service';
import {
  grupoDeLaVentana,
  FEATURED_ROTATION_WINDOW_SECONDS,
} from 'src/modules/search/search.controller';

const INDEX_NAME = process.env.MEILI_INDEX_NAME ?? 'listings_test';
const TAM_BLOQUE = 4;

interface DocDestacado extends Record<string, unknown> {
  boostScore: number;
  featuredStartsAt: number | null;
  featuredExpiresAt: number | null;
}

describe('ROTACIÓN R2 — el bloque «Promocionados» se turna (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let meili: MeiliSearch;
  let searchService: SearchService;
  let userId: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    meili = buildMeiliClient();
    app = await createTestApp();
    await app.init();

    searchService = app.get(SearchService);

    await cleanDb(prisma);
    await resetMeili(meili);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const user = await prisma.user.create({
      data: {
        email: 'rota-r2-seller@example.com',
        name: 'RotaR2 Seller',
        slug: 'rota-r2-seller',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    userId = user.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Utillaje
  // ---------------------------------------------------------------------------

  async function crearAnuncio(titulo: string, publishedAt: Date, precio: string) {
    const slug = `rota-r2-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return prisma.listing.create({
      data: {
        title: titulo,
        slug,
        description: titulo,
        price: new Prisma.Decimal(precio),
        currency: 'EUR',
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        categoryId,
        sellerId: userId,
        publishedAt,
      },
    });
  }

  async function destacar(listingId: string, startsAt: Date, expiresAt: Date) {
    return prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.FEATURED_LISTING,
        listingId,
        startsAt,
        expiresAt,
        revokedAt: null,
      },
    });
  }

  async function indexar(listingId: string) {
    const listing = await prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      include: INDEX_INCLUDE,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await searchService.indexListing(listing as any);
  }

  /** Crea un destacado ya indexado y confirmado en Meilisearch. */
  async function destacadoListo(opciones: {
    titulo: string;
    publishedAt: Date;
    concedido: Date;
    vence: Date;
    precio: string;
  }): Promise<string> {
    const anuncio = await crearAnuncio(opciones.titulo, opciones.publishedAt, opciones.precio);
    await destacar(anuncio.id, opciones.concedido, opciones.vence);
    await indexar(anuncio.id);
    await waitForDocumentWhere<DocDestacado>(
      meili,
      INDEX_NAME,
      anuncio.id,
      (d) => d.boostScore === 1 && d.featuredStartsAt !== null,
      { description: `a que "${opciones.titulo}" se indexe como destacado` },
    );
    return anuncio.id;
  }

  /**
   * EL ORÁCULO. Pregunta a Meilisearch qué anuncios forman el grupo `pagina` del anillo, con
   * la MISMA consulta que el controlador dice usar — pero por fuera de él.
   */
  async function grupoDelAnillo(q: string, pagina: number, ahoraSegundos: number) {
    const res = await meili.index(INDEX_NAME).search(q, {
      filter: [
        'boostScore = 1',
        `(featuredExpiresAt IS NULL OR featuredExpiresAt > ${ahoraSegundos})`,
      ],
      sort: ['featuredStartsAt:asc'],
      page: pagina,
      hitsPerPage: TAM_BLOQUE,
    });
    return {
      ids: (res.hits as { id: string }[]).map((h) => h.id),
      grupos: res.totalPages ?? 1,
      total: res.totalHits ?? 0,
    };
  }

  /** El instante (ms) de la ventana `desplazamiento` a partir de la actual, ya alineado. */
  function instanteDeVentana(desplazamiento: number): number {
    const ventanaActual = Math.floor(Date.now() / 1000 / FEATURED_ROTATION_WINDOW_SECONDS);
    return ((ventanaActual + desplazamiento) * FEATURED_ROTATION_WINDOW_SECONDS + 1) * 1000;
  }

  /**
   * Ejecuta `fn` con el reloj congelado en `instanteMs`. Se restaura SIEMPRE — un `Date.now`
   * suplantado que sobreviviera al test envenenaría todos los siguientes.
   */
  async function conRelojEn<T>(instanteMs: number, fn: () => Promise<T>): Promise<T> {
    const espia = jest.spyOn(Date, 'now').mockReturnValue(instanteMs);
    try {
      return await fn();
    } finally {
      espia.mockRestore();
    }
  }

  async function bloque(q: string, extra: Record<string, string> = {}): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get('/api/search')
      .query({ q, ...extra })
      .expect(200);
    return (res.body.featured as { id: string }[]).map((h) => h.id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 1 — rota por ventana, y en un ciclo salen todos
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 1 — nueve destacados, tres grupos, tres ventanas', () => {
    const Q = 'RotaR2Anillo';
    const N = 9; // 9 destacados → 3 grupos (4 + 4 + 1)
    const anillo: string[] = []; // en orden de CONCESIÓN (el orden del anillo)

    beforeAll(async () => {
      // LAS CONCESIONES VAN AL REVÉS QUE LAS PUBLICACIONES, y no es un capricho: es lo que
      // hace que este test distinga el orden del anillo del orden de la lista. Si el
      // controlador usara `dto.sort` (o el desempate por `sortDate`), el grupo saldría en el
      // orden contrario y no coincidiría con el oráculo.
      const base = Date.now();
      for (let i = 0; i < N; i++) {
        const id = await destacadoListo({
          titulo: `${Q} Telefono`,
          publishedAt: new Date(base - i * 1_000), // el 0 es el más NUEVO
          concedido: new Date(base - (N - i) * 60_000), // el 0 es el MÁS ANTIGUO concedido
          vence: new Date(base + 7 * 24 * 60 * 60 * 1000),
          precio: String(100 + i * 50),
        });
        anillo.push(id);
      }
    }, 120_000);

    it('el anillo tiene los nueve y se parte en tres grupos', async () => {
      const { grupos, total } = await grupoDelAnillo(Q, 1, Math.floor(Date.now() / 1000));
      expect(total).toBe(N);
      expect(grupos).toBe(Math.ceil(N / TAM_BLOQUE)); // 3
    });

    it('CADA VENTANA DEVUELVE SU GRUPO — y el bloque coincide con el oráculo', async () => {
      for (let v = 0; v < 3; v++) {
        const instante = instanteDeVentana(v);
        const turno = grupoDeLaVentana(instante, 3);
        const esperado = await grupoDelAnillo(Q, turno, Math.floor(instante / 1000));

        const servido = await conRelojEn(instante, () => bloque(Q));

        expect(servido).toEqual(esperado.ids);
      }
    }, 60_000);

    it('VENTANAS CONSECUTIVAS DEVUELVEN GRUPOS DISTINTOS Y DISJUNTOS', async () => {
      // El corazón de la ráfaga: antes, dos peticiones cualesquiera devolvían los MISMOS 4.
      const primera = await conRelojEn(instanteDeVentana(0), () => bloque(Q));
      const segunda = await conRelojEn(instanteDeVentana(1), () => bloque(Q));

      expect(segunda).not.toEqual(primera);
      expect(primera.filter((id) => segunda.includes(id))).toEqual([]);
    }, 60_000);

    it('UN CICLO COMPLETO SACA A LOS NUEVE: nadie se queda sin vitrina', async () => {
      // La promesa entera, extremo a extremo. Antes de R2, cinco de estos nueve no habrían
      // salido jamás.
      const vistos = new Set<string>();
      for (let v = 0; v < 3; v++) {
        const grupo = await conRelojEn(instanteDeVentana(v), () => bloque(Q));
        grupo.forEach((id) => vistos.add(id));
      }

      expect(vistos.size).toBe(N);
      expect([...vistos].sort()).toEqual([...anillo].sort());
    }, 90_000);

    it('el grupo parcial se acepta: la última ventana del ciclo va menos llena', async () => {
      // 9 no es múltiplo de 4, así que un grupo trae 1. Se acepta a propósito (diseño D3): el
      // reparto sigue siendo un grupo por anuncio y por ciclo, y esa ventana es la de los
      // recién llegados, que salen con menos competencia.
      const tamaños: number[] = [];
      for (let v = 0; v < 3; v++) {
        tamaños.push((await conRelojEn(instanteDeVentana(v), () => bloque(Q))).length);
      }
      expect(tamaños.sort()).toEqual([1, 4, 4]);
    }, 90_000);

    // ═════════════════════════════════════════════════════════════════════════
    // BARRERA 5 — el orden es PROPIO, no el del usuario
    // ═════════════════════════════════════════════════════════════════════════

    it('BARRERA 5 — cambiar el `sort` pedido NO reordena el anillo', async () => {
      // Los precios de los nueve van de 100 a 500. Con el comportamiento anterior, «precio
      // asc» y «precio desc» habrían dado bloques OPUESTOS (los 4 más baratos vs los 4 más
      // caros). Con el anillo, la vitrina es la misma: el turno no depende de lo que el
      // visitante haya pedido ordenar.
      const instante = instanteDeVentana(0);
      const barato = await conRelojEn(instante, () => bloque(Q, { sort: 'price:asc' }));
      const caro = await conRelojEn(instante, () => bloque(Q, { sort: 'price:desc' }));
      const sinOrden = await conRelojEn(instante, () => bloque(Q));

      expect(barato).toEqual(sinOrden);
      expect(caro).toEqual(sinOrden);
    }, 60_000);

    it('BARRERA 5 — pero los FILTROS se siguen respetando enteros', async () => {
      // Lo que NO cambia con R2: el bloque nunca enseña un destacado que incumpla lo que el
      // usuario ha pedido. Se acota por precio y el bloque se acota con él.
      const instante = instanteDeVentana(0);
      const acotado = await conRelojEn(instante, () =>
        request(app.getHttpServer())
          .get('/api/search')
          .query({ q: Q, maxPrice: '200' })
          .expect(200)
          .then((r) => r.body.featured as Record<string, unknown>[]),
      );

      expect(acotado.length).toBeGreaterThan(0);
      for (const hit of acotado) expect(Number(hit.price)).toBeLessThanOrEqual(200);
    }, 60_000);

    // ═════════════════════════════════════════════════════════════════════════
    // BARRERA 6 — la rotación vive SOLO en el bloque
    // ═════════════════════════════════════════════════════════════════════════

    it('BARRERA 6 — ni la lista ni el conteo se enteran de la rotación', async () => {
      const enUna = await conRelojEn(instanteDeVentana(0), () =>
        request(app.getHttpServer()).get('/api/search').query({ q: Q }).expect(200),
      );
      const enOtra = await conRelojEn(instanteDeVentana(1), () =>
        request(app.getHttpServer()).get('/api/search').query({ q: Q }).expect(200),
      );

      // El conteo es el de los anuncios reales, y no se mueve entre ventanas.
      expect(enUna.body.totalHits).toBe(N);
      expect(enOtra.body.totalHits).toBe(N);

      // La lista es la misma en las dos ventanas y sigue el orden de siempre (Política C:
      // el desempate es `sortDate:desc`, el más recién publicado primero) — el anillo NO la
      // toca.
      const listaUna = (enUna.body.hits as { id: string }[]).map((h) => h.id);
      const listaOtra = (enOtra.body.hits as { id: string }[]).map((h) => h.id);
      expect(listaOtra).toEqual(listaUna);
      // `anillo[0]` es el PRIMERO del anillo (el concedido más antiguo) y a la vez el más
      // recién PUBLICADO — las dos escalas van al revés a propósito (ver el beforeAll). Que
      // encabece la lista mientras el anillo lo coloca el primero del primer grupo es
      // justamente la prueba de que las dos ordenaciones son independientes.
      expect(listaUna[0]).toBe(anillo[0]);
    }, 60_000);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 2 — con N ≤ 4 no se rota ni se paga una consulta de más
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 2 — el caso mayoritario cuesta lo que costaba', () => {
    const Q_CORTO = 'RotaR2Corto';
    const cortos: string[] = [];

    beforeAll(async () => {
      const base = Date.now();
      for (let i = 0; i < 3; i++) {
        cortos.push(
          await destacadoListo({
            titulo: `${Q_CORTO} Telefono`,
            publishedAt: new Date(base - i * 1_000),
            concedido: new Date(base - (3 - i) * 60_000),
            vence: new Date(base + 7 * 24 * 60 * 60 * 1000),
            precio: '100',
          }),
        );
      }
    }, 60_000);

    /** Cuenta las llamadas REALES a `SearchService.search` mientras se sirve una petición. */
    async function consultasDurante(fn: () => Promise<unknown>): Promise<number> {
      const original = searchService.search.bind(searchService);
      let llamadas = 0;
      const espia = jest
        .spyOn(searchService, 'search')
        .mockImplementation((params) => {
          llamadas += 1;
          return original(params);
        });
      try {
        await fn();
        return llamadas;
      } finally {
        espia.mockRestore();
      }
    }

    it('con 3 destacados salen SIEMPRE los 3, en cualquier ventana', async () => {
      const enUna = await conRelojEn(instanteDeVentana(0), () => bloque(Q_CORTO));
      const enOtra = await conRelojEn(instanteDeVentana(1), () => bloque(Q_CORTO));
      const enOtraMas = await conRelojEn(instanteDeVentana(7), () => bloque(Q_CORTO));

      expect(enUna).toHaveLength(3);
      expect(enOtra).toEqual(enUna);
      expect(enOtraMas).toEqual(enUna);
    }, 60_000);

    it('y NO se lanza la segunda consulta: dos en total, la lista y el bloque', async () => {
      // Donde no hay competencia por la vitrina no hay coste nuevo. La mutación «lanzar
      // siempre la consulta B» muere aquí.
      const llamadas = await consultasDurante(() =>
        conRelojEn(instanteDeVentana(3), () => bloque(Q_CORTO)),
      );
      expect(llamadas).toBe(2);
    }, 60_000);

    it('con N > 4 la segunda consulta se paga SÓLO cuando el turno no es el primer grupo', async () => {
      // La otra mitad del coste: con 9 destacados y 3 grupos, la ventana cuyo turno es el
      // grupo 1 se sirve con la consulta que ya se hizo (2 llamadas); las otras dos pagan la
      // consulta B (3 llamadas).
      const porTurno = new Map<number, number>();
      for (let v = 0; v < 3; v++) {
        const instante = instanteDeVentana(v);
        const turno = grupoDeLaVentana(instante, 3);
        porTurno.set(
          turno,
          await consultasDurante(() => conRelojEn(instante, () => bloque('RotaR2Anillo'))),
        );
      }

      expect(porTurno.get(1)).toBe(2); // el turno 1 reaprovecha la consulta A
      expect(porTurno.get(2)).toBe(3);
      expect(porTurno.get(3)).toBe(3);
    }, 90_000);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EMPATES — el reparto no se rompe cuando dos concesiones caen en el mismo segundo
  // ═══════════════════════════════════════════════════════════════════════════

  it('con la MISMA fecha de concesión el ciclo sigue sacando a todos, una vez cada uno', async () => {
    // POR QUÉ ESTO NO ES UN CASO RARO: `featuredStartsAt` va en SEGUNDOS, y varias concesiones
    // del mismo vendedor (o de un cupón aplicado en lote) caen en el mismo segundo con toda
    // facilidad. Si con la clave empatada la paginación no fuese estable, un anuncio podría
    // salir en dos grupos —o en ninguno— y la promesa «todos salen un turno por ciclo» sería
    // falsa justo para quien compra varios a la vez. Aquí se comprueba que no pasa: el
    // desempate lo resuelven las reglas de Meilisearch de forma determinista para un índice
    // dado, y la partición en grupos sigue siendo limpia.
    const Q = 'RotaR2Empate';
    const base = Date.now();
    const mismoInstante = new Date(base - 30_000);
    const creados: string[] = [];

    for (let i = 0; i < 6; i++) {
      creados.push(
        await destacadoListo({
          titulo: `${Q} Telefono`,
          publishedAt: new Date(base - i * 1_000),
          concedido: mismoInstante, // TODOS a la vez
          vence: new Date(base + 7 * 24 * 60 * 60 * 1000),
          precio: '100',
        }),
      );
    }

    const { grupos } = await grupoDelAnillo(Q, 1, Math.floor(Date.now() / 1000));
    expect(grupos).toBe(2); // 6 destacados → 4 + 2

    const apariciones = new Map<string, number>();
    for (let v = 0; v < grupos; v++) {
      for (const id of await conRelojEn(instanteDeVentana(v), () => bloque(Q))) {
        apariciones.set(id, (apariciones.get(id) ?? 0) + 1);
      }
    }

    expect([...apariciones.keys()].sort()).toEqual([...creados].sort()); // ninguno ausente
    for (const veces of apariciones.values()) expect(veces).toBe(1); // ninguno repetido
  }, 120_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 3 — el anuncio antiguo entra en el anillo
  // ═══════════════════════════════════════════════════════════════════════════

  it('BARRERA 3 — un anuncio de hace tres meses que se destaca HOY sale en su turno', async () => {
    // EL CASO QUE MOTIVÓ TODA LA RÁFAGA. Con el reparto anterior este anuncio no habría
    // salido ni un solo día de los que pagó: `publishedAt` lo dejaba el último de la cola,
    // para siempre. Ahora entra por su fecha de CONCESIÓN, que es la más reciente de todas,
    // así que ocupa el final del anillo — y el final del anillo también tiene su ventana.
    const Q = 'RotaR2Antiguo';
    const base = Date.now();
    const HACE_TRES_MESES = new Date(base - 90 * 24 * 60 * 60 * 1000);

    const recientes: string[] = [];
    for (let i = 0; i < 4; i++) {
      recientes.push(
        await destacadoListo({
          titulo: `${Q} Telefono`,
          publishedAt: new Date(base - i * 1_000), // publicados hoy
          concedido: new Date(base - (10 - i) * 60_000), // concedidos ANTES que el viejo
          vence: new Date(base + 7 * 24 * 60 * 60 * 1000),
          precio: '100',
        }),
      );
    }

    const viejo = await destacadoListo({
      titulo: `${Q} Telefono`,
      publishedAt: HACE_TRES_MESES,
      concedido: new Date(base), // destacado AHORA MISMO
      vence: new Date(base + 7 * 24 * 60 * 60 * 1000),
      precio: '100',
    });

    // Con 5 destacados hay 2 grupos; el viejo es el último del anillo, así que le toca el 2.
    const { grupos } = await grupoDelAnillo(Q, 1, Math.floor(Date.now() / 1000));
    expect(grupos).toBe(2);

    const vistos = new Set<string>();
    for (let v = 0; v < grupos; v++) {
      (await conRelojEn(instanteDeVentana(v), () => bloque(Q))).forEach((id) => vistos.add(id));
    }

    expect(vistos.has(viejo)).toBe(true); // lo que antes era imposible
    expect(vistos.size).toBe(recientes.length + 1); // y sin desplazar a nadie
  }, 120_000);

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 4 — el caducado sale de la rotación sin esperar al cron
  // ═══════════════════════════════════════════════════════════════════════════

  it('BARRERA 4 — un periodo vencido deja de ocupar turno aunque boostScore siga a 1', async () => {
    // EL ESTADO REAL QUE SE REPRODUCE: el documento se escribió cuando el destacado estaba
    // vivo, el periodo venció después, y el cron de las 03:00 aún no ha pasado. Hasta R2 ese
    // anuncio seguía ocupando un hueco de la vitrina hasta ~23 h — un turno que le
    // corresponde a alguien que sí está pagando. Se simula tocando el documento en
    // Meilisearch, que es exactamente lo que el índice tendría en ese momento.
    const Q = 'RotaR2Caducado';
    const base = Date.now();

    const vivo = await destacadoListo({
      titulo: `${Q} Telefono`,
      publishedAt: new Date(base),
      concedido: new Date(base - 60_000),
      vence: new Date(base + 7 * 24 * 60 * 60 * 1000),
      precio: '100',
    });
    const vencido = await destacadoListo({
      titulo: `${Q} Telefono`,
      publishedAt: new Date(base - 1_000),
      concedido: new Date(base - 120_000),
      vence: new Date(base + 7 * 24 * 60 * 60 * 1000),
      precio: '100',
    });

    // El periodo venció AYER, y el documento se queda rancio: boostScore SIGUE a 1.
    //
    // Un día, no un minuto: el reloj de este test se sitúa al principio de la ventana en
    // curso, que puede ser hasta quince minutos anterior al `base` real. Un vencimiento de
    // hace un minuto quedaría, según la hora a la que se ejecute la suite, todavía en el
    // futuro — un test verde o rojo según el reloj, que es peor que no tenerlo.
    const tarea = await meili
      .index(INDEX_NAME)
      .updateDocuments([{ id: vencido, featuredExpiresAt: Math.floor(base / 1000) - 86_400 }]);
    await meili.waitForTask(tarea.taskUid);

    const doc = await meili.index(INDEX_NAME).getDocument<DocDestacado>(vencido);
    expect(doc.boostScore).toBe(1); // el cron no ha pasado: sigue "destacado" para el badge

    const servido = await conRelojEn(instanteDeVentana(0), () => bloque(Q));

    expect(servido).toContain(vivo);
    expect(servido).not.toContain(vencido); // fuera de la vitrina YA, sin esperar al cron
  }, 90_000);
});
