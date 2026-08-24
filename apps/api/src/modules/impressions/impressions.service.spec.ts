/**
 * ESTADÍSTICAS A1 — las garantías de la CAPTURA que se pueden fijar sin infraestructura.
 *
 * Estas son las que hablan de la FORMA del contador —que no se pueda esperar, que no
 * pueda romper la búsqueda, cuántas operaciones hace, con qué claves— y por eso van aquí
 * y no en la e2e: con Redis de verdad no se puede comprobar «no lanza cuando Redis se
 * cae» ni contar operaciones sin acoplarse al cliente.
 *
 * Las que sí necesitan infraestructura (que la impresión ACABE en la tabla, el drenaje
 * atómico, que las alertas no cuenten) están en test/estadisticas-a1-impresiones.e2e-spec.ts.
 */
import { Logger } from '@nestjs/common';
import { ImpressionsService } from './impressions.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';

/** Deja correr los microtasks pendientes: el contador es fire-and-forget. */
const drainMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

describe('ImpressionsService — la captura (A1)', () => {
  let pipeline: { hincrby: jest.Mock; exec: jest.Mock };
  let client: {
    set: jest.Mock;
    pipeline: jest.Mock;
    scan: jest.Mock;
    rename: jest.Mock;
    hgetall: jest.Mock;
    del: jest.Mock;
  };
  let prisma: { $transaction: jest.Mock; $executeRaw: jest.Mock };
  let service: ImpressionsService;

  const ENTRADA = {
    listingIds: ['a1', 'a2', 'a3'],
    forwardedVisitorHash: 'visitante-1',
    ip: '10.0.0.1',
    userAgent: 'jest',
    query: { q: 'sofa', page: '1' },
  };

  beforeEach(() => {
    pipeline = { hincrby: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) };
    client = {
      set: jest.fn().mockResolvedValue('OK'),
      pipeline: jest.fn(() => pipeline),
      scan: jest.fn().mockResolvedValue(['0', []]),
      rename: jest.fn().mockResolvedValue('OK'),
      hgetall: jest.fn().mockResolvedValue({}),
      del: jest.fn().mockResolvedValue(1),
    };
    prisma = {
      $transaction: jest.fn().mockResolvedValue([1, 1]),
      $executeRaw: jest.fn().mockReturnValue('stmt'),
    };
    service = new ImpressionsService(
      prisma as unknown as PrismaService,
      { client } as unknown as RedisService,
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  // Se drena ANTES de restaurar: el contador es fire-and-forget, así que un test que no
  // espera (el de «devuelve undefined») deja un `setImmediate` pendiente que, sin esto,
  // se ejecutaría en medio del test SIGUIENTE y contaminaría sus mocks. Es la misma
  // clase de fuga que el propio servicio provoca a propósito en producción, donde no
  // molesta a nadie.
  afterEach(async () => {
    await drainMicrotasks();
    jest.restoreAllMocks();
  });

  // ── BARRERA 3 — sin latencia y fail-open ───────────────────────────────────────

  describe('BARRERA 3 — la búsqueda no espera y no se rompe', () => {
    it('devuelve `undefined`, no una promesa: no HAY nada que esperar', () => {
      // La garantía es estructural, no de disciplina: quien llama no puede ponerle un
      // `await` delante aunque quiera, porque no hay promesa que esperar. Es lo que
      // impide que un refactor futuro cuele latencia en la ruta más caliente.
      const resultado: void = service.recordServedResults(ENTRADA);

      expect(resultado).toBeUndefined();
      // Y en el momento de volver, NADA ha ocurrido todavía: ni el dedup, ni el
      // hashing, ni el pipeline. Es lo que `setImmediate` compra — sin él, el cuerpo
      // de `accumulate` correría hasta su primer `await` en ESTA pila, es decir,
      // dentro de la petición de búsqueda.
      expect(client.set).not.toHaveBeenCalled();
      expect(client.pipeline).not.toHaveBeenCalled();
    });

    it('con Redis caído NO lanza: la impresión se pierde, la búsqueda no se entera', async () => {
      client.set.mockRejectedValue(new Error('ECONNREFUSED'));

      expect(() => service.recordServedResults(ENTRADA)).not.toThrow();
      await drainMicrotasks();

      expect(Logger.prototype.warn).toHaveBeenCalled();
      expect(pipeline.hincrby).not.toHaveBeenCalled();
    });

    it('si el pipeline de incrementos falla, tampoco lanza', async () => {
      pipeline.exec.mockRejectedValue(new Error('redis se fue a mitad'));

      expect(() => service.recordServedResults(ENTRADA)).not.toThrow();
      await drainMicrotasks();

      expect(Logger.prototype.warn).toHaveBeenCalled();
    });

    it('sin anuncios servidos no toca Redis en absoluto', async () => {
      service.recordServedResults({ ...ENTRADA, listingIds: [] });
      await drainMicrotasks();

      expect(client.set).not.toHaveBeenCalled();
      expect(client.pipeline).not.toHaveBeenCalled();
    });
  });

  // ── BARRERA 2 — el dedup es POR BÚSQUEDA, no por anuncio ───────────────────────

  describe('BARRERA 2 — dedup por búsqueda: UNA operación, no una por anuncio', () => {
    it('tres anuncios servidos → UN `SET NX` y UN pipeline con tres `HINCRBY`', async () => {
      service.recordServedResults(ENTRADA);
      await drainMicrotasks();

      // La mutación que esto cierra: un dedup por ANUNCIO serían tres `set` (y 24 en
      // una búsqueda real), más ~24x memoria en Redis, para responder peor.
      expect(client.set).toHaveBeenCalledTimes(1);
      expect(client.pipeline).toHaveBeenCalledTimes(1);
      expect(pipeline.hincrby).toHaveBeenCalledTimes(3);
      expect(pipeline.exec).toHaveBeenCalledTimes(1);
    });

    it('el `SET` es NX con la ventana de 30 minutos (la misma que las vistas)', async () => {
      service.recordServedResults(ENTRADA);
      await drainMicrotasks();

      expect(client.set).toHaveBeenCalledWith(expect.any(String), '1', 'EX', 1800, 'NX');
    });

    it('si la búsqueda ya contó (NX rechaza) NO se incrementa nada', async () => {
      client.set.mockResolvedValue(null);

      service.recordServedResults(ENTRADA);
      await drainMicrotasks();

      expect(client.pipeline).not.toHaveBeenCalled();
    });

    it('los incrementos van al cubo del día UTC, con la fecha en el NOMBRE de la clave', async () => {
      service.recordServedResults(ENTRADA);
      await drainMicrotasks();

      const hoy = new Date().toISOString().slice(0, 10);
      expect(pipeline.hincrby).toHaveBeenCalledWith(`imp:bucket:${hoy}`, 'a1', 1);
    });
  });

  // ── La huella de «esta búsqueda» ───────────────────────────────────────────────

  describe('qué identifica a una búsqueda', () => {
    async function claveDedup(entrada: Parameters<ImpressionsService['recordServedResults']>[0]) {
      client.set.mockClear();
      service.recordServedResults(entrada);
      await drainMicrotasks();
      return client.set.mock.calls[0][0] as string;
    }

    it('el ORDEN de los parámetros no cambia la búsqueda', async () => {
      const a = await claveDedup({ ...ENTRADA, query: { q: 'sofa', page: '1' } });
      const b = await claveDedup({ ...ENTRADA, query: { page: '1', q: 'sofa' } });

      expect(a).toBe(b);
    });

    it('pero la PÁGINA sí: página 2 es otra aparición, no una repetición', async () => {
      const p1 = await claveDedup({ ...ENTRADA, query: { q: 'sofa', page: '1' } });
      const p2 = await claveDedup({ ...ENTRADA, query: { q: 'sofa', page: '2' } });

      expect(p1).not.toBe(p2);
    });
  });

  // ── La identidad del visitante (la mutación del BFF) ───────────────────────────

  describe('la identidad del visitante', () => {
    async function claveDedup(entrada: Parameters<ImpressionsService['recordServedResults']>[0]) {
      client.set.mockClear();
      service.recordServedResults(entrada);
      await drainMicrotasks();
      return client.set.mock.calls[0][0] as string;
    }

    it('dos visitantes con cabecera distinta NO se deduplican entre sí', async () => {
      const a = await claveDedup({ ...ENTRADA, forwardedVisitorHash: 'visitante-A' });
      const b = await claveDedup({ ...ENTRADA, forwardedVisitorHash: 'visitante-B' });

      expect(a).not.toBe(b);
    });

    it('LA MUTACIÓN: sin la cabecera del BFF, misma IP+UA = mismo visitante', async () => {
      // Esto es exactamente lo que pasaría si el BFF dejara de reenviar la identidad:
      // como /busqueda es Server Component, TODAS las peticiones llegan con la IP del
      // servidor de Next, así que todos los visitantes colapsarían en uno y el dedup
      // mataría todas las impresiones menos la primera. El test no lo «aprueba»: fija
      // que la degradación es esta y no otra, y que es hacia contar de MENOS.
      const a = await claveDedup({ ...ENTRADA, forwardedVisitorHash: undefined });
      const b = await claveDedup({ ...ENTRADA, forwardedVisitorHash: undefined });

      expect(a).toBe(b);
    });

    it('sin cabecera, dos IPs distintas sí se distinguen (llamada directa a la API)', async () => {
      const a = await claveDedup({ ...ENTRADA, forwardedVisitorHash: undefined, ip: '1.1.1.1' });
      const b = await claveDedup({ ...ENTRADA, forwardedVisitorHash: undefined, ip: '2.2.2.2' });

      expect(a).not.toBe(b);
    });

    it('una cabecera basura no produce una clave basura: siempre 64 hex', async () => {
      const clave = await claveDedup({
        ...ENTRADA,
        forwardedVisitorHash: 'x'.repeat(5000) + ' \n:*',
      });

      expect(clave).toMatch(/^imp:dedup:[0-9a-f]{64}:[0-9a-f]{64}$/);
    });
  });

  // ── BARRERA 5 — el drenaje ─────────────────────────────────────────────────────

  describe('BARRERA 5 — el drenaje es atómico e idempotente', () => {
    const HOY = new Date().toISOString().slice(0, 10);

    it('renombra el cubo vivo antes de leerlo (RENAME, no leer-y-borrar)', async () => {
      client.scan.mockResolvedValue(['0', [`imp:bucket:${HOY}`]]);
      client.hgetall.mockResolvedValue({ a1: '3' });

      await service.flushImpressions();

      expect(client.rename).toHaveBeenCalledWith(
        `imp:bucket:${HOY}`,
        expect.stringMatching(new RegExp(`^imp:bucket:${HOY}:draining:[0-9a-f]{12}$`)),
      );
      // Y lee el RENOMBRADO, nunca el vivo: los HINCRBY que lleguen durante el volcado
      // caen en un cubo nuevo y limpio, y no se pierde ni uno.
      expect(client.hgetall).toHaveBeenCalledWith(expect.stringContaining(':draining:'));
      expect(client.hgetall).not.toHaveBeenCalledWith(`imp:bucket:${HOY}`);
    });

    it('un cubo HUÉRFANO de un volcado fallido se reintenta, sin volver a renombrarlo', async () => {
      client.scan.mockResolvedValue(['0', [`imp:bucket:${HOY}:draining:deadbeef1234`]]);
      client.hgetall.mockResolvedValue({ a1: '2' });

      const resultado = await service.flushImpressions();

      expect(client.rename).not.toHaveBeenCalled();
      expect(resultado.buckets).toBe(1);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(client.del).toHaveBeenCalledWith(`imp:bucket:${HOY}:draining:deadbeef1234`);
    });

    it('el token aleatorio impide que dos ciclos se pisen el destino', async () => {
      client.scan.mockResolvedValue(['0', [`imp:bucket:${HOY}`]]);
      client.hgetall.mockResolvedValue({ a1: '1' });

      await service.flushImpressions();
      await service.flushImpressions();

      const [primero, segundo] = client.rename.mock.calls.map((c) => c[1] as string);
      expect(primero).not.toBe(segundo);
    });

    it('si el RENAME falla (la clave se esfumó) no se aborta el resto del ciclo', async () => {
      client.scan.mockResolvedValue([
        '0',
        [`imp:bucket:${HOY}`, `imp:bucket:${HOY}:draining:aaaaaaaaaaaa`],
      ]);
      client.rename.mockRejectedValue(new Error('ERR no such key'));
      client.hgetall.mockResolvedValue({ a1: '1' });

      const resultado = await service.flushImpressions();

      // El huérfano se drena igual: un fallo en un cubo no arrastra a los demás.
      expect(resultado.buckets).toBe(1);
    });

    it('un cubo vacío se borra sin escribir en la base', async () => {
      client.scan.mockResolvedValue(['0', [`imp:bucket:${HOY}`]]);
      client.hgetall.mockResolvedValue({});

      await service.flushImpressions();

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(client.del).toHaveBeenCalled();
    });

    it('un contador ilegible se descarta sin tumbar el cubo entero', async () => {
      client.scan.mockResolvedValue(['0', [`imp:bucket:${HOY}`]]);
      client.hgetall.mockResolvedValue({ bueno: '5', roto: 'NaN', cero: '0' });

      const resultado = await service.flushImpressions();

      expect(resultado.listings).toBe(1); // solo `bueno`
    });

    it('si el volcado a la base falla, el cubo NO se borra: lo reintenta el ciclo siguiente', async () => {
      client.scan.mockResolvedValue(['0', [`imp:bucket:${HOY}:draining:bbbbbbbbbbbb`]]);
      client.hgetall.mockResolvedValue({ a1: '1' });
      prisma.$transaction.mockRejectedValue(new Error('la base dijo que no'));

      await expect(service.flushImpressions()).resolves.toEqual({ buckets: 1, listings: 0 });

      expect(client.del).not.toHaveBeenCalled();
    });

    it('recorre TODO el cursor del SCAN, no solo la primera página', async () => {
      client.scan
        .mockResolvedValueOnce(['17', [`imp:bucket:${HOY}`]])
        .mockResolvedValueOnce(['0', [`imp:bucket:2020-01-01:draining:cccccccccccc`]]);
      client.hgetall.mockResolvedValue({ a1: '1' });

      const resultado = await service.flushImpressions();

      expect(resultado.buckets).toBe(2);
    });

    it('sin cubos no escribe nada', async () => {
      const resultado = await service.flushImpressions();

      expect(resultado).toEqual({ buckets: 0, listings: 0 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
