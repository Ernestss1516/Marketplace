import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';

/**
 * ESTADÍSTICAS A1 — LA CAPTURA DE «VECES LISTADO» (impresiones de búsqueda).
 *
 * Una IMPRESIÓN es la aparición de un anuncio en el conjunto de resultados de UNA
 * respuesta servida por `GET /search`. Se cuenta el CONJUNTO (no el multiconjunto):
 * una respuesta, como mucho una impresión por anuncio. Ver docs/diseno-estadisticas.md
 * §2.1 para el perímetro completo (qué cuenta, qué no y por qué).
 *
 * ─── LAS TRES REGLAS QUE GOBIERNAN ESTE FICHERO ──────────────────────────────────
 *
 * 1. **LA BÚSQUEDA NO ESPERA.** `recordServedResults` devuelve `void`, no una promesa,
 *    y lo hace A PROPÓSITO: quien lo llama **no puede** ponerle un `await` delante ni
 *    por descuido. La ruta de búsqueda es la más caliente del producto y esto es una
 *    métrica de vanidad; el orden de prioridades no admite discusión. Todo el trabajo
 *    —incluido el hashing— se aplaza con `setImmediate`, así que lo único que la
 *    petición paga es encolar un callback.
 *
 * 2. **FAIL-OPEN.** Si Redis no responde, o responde raro, o el pipeline falla, se
 *    registra un `warn` y se sigue. Una impresión perdida no es nada; una búsqueda rota
 *    por el contador de impresiones sería un desastre desproporcionado. Mismo trato que
 *    el frontend le da a `trackView`: «el tracking nunca debe afectar la experiencia»
 *    (apps/web/src/lib/api/anuncios.ts).
 *
 * 3. **CERO ESCRITURAS A POSTGRES EN LA PETICIÓN.** La petición sólo hace `HINCRBY`
 *    sobre un hash de Redis. Las filas de la tabla diaria las escribe `flushImpressions`
 *    desde un cron, en lote. Escribir por impresión serían 24 `upsert` por búsqueda
 *    —y, peor, contención sobre las filas de los anuncios que salen en TODAS las
 *    búsquedas de una categoría. Ver §2.2 y §2.6 del diseño.
 *
 * ─── POR QUÉ NO UNA COLA BULLMQ ──────────────────────────────────────────────────
 *
 * Porque encolar es, en sí, una escritura en Redis (BullMQ vive sobre Redis). Cambiar
 * 24 escrituras en Postgres por 1 escritura en Redis + un job + un worker es más caro y
 * más complicado que cambiarlas por 1 escritura en Redis y punto. La cola aportaría
 * reintentos y aislamiento, que aquí no hacen falta: una impresión perdida no es un
 * cobro perdido. El trabajo periódico —el volcado— va por `@Cron`, que es el molde del
 * repo para eso (ver `ImpressionsScheduleService`).
 */
@Injectable()
export class ImpressionsService {
  private readonly logger = new Logger(ImpressionsService.name);

  /**
   * Ventana de deduplicación: la MISMA que las vistas
   * (`ListingsService.VIEW_DEDUP_TTL_SECONDS`), para que las dos series de la gráfica
   * de A2 se hayan medido con el mismo criterio y sean comparables.
   */
  private static readonly DEDUP_TTL_SECONDS = 60 * 30;

  /** Días de granularidad diaria que se conservan. Ver `purgeOldDailyRows`. */
  static readonly RETENTION_DAYS = 180;

  /** Filas por sentencia en el volcado. Ver `writeChunk`. */
  private static readonly CHUNK_SIZE = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ---------------------------------------------------------------------------
  // Las claves de Redis
  // ---------------------------------------------------------------------------
  //
  // El acumulador VIVO y el que se está DRENANDO comparten el prefijo `imp:bucket:`
  // para que un solo `SCAN` los encuentre a los dos, y NO lo comparte el dedup
  // (`imp:dedup:`), que son muchas claves efímeras y no tiene ninguna gracia
  // recorrerlas en el cron.
  //
  // LA FECHA VA EN EL NOMBRE DE LA CLAVE, no se resuelve al volcar: si un volcado
  // cruza la medianoche UTC, lo acumulado ayer tiene que escribirse con la fecha de
  // AYER. Con la fecha fuera de la clave, el cubo no sabría a qué día pertenece.

  private static liveBucket(date: string): string {
    return `imp:bucket:${date}`;
  }

  private static drainBucket(date: string, token: string): string {
    return `imp:bucket:${date}:draining:${token}`;
  }

  private static readonly BUCKET_PATTERN = 'imp:bucket:*';

  /** ¿Es una clave ya renombrada (en curso de volcado o huérfana de uno fallido)? */
  private static isDraining(key: string): boolean {
    return key.includes(':draining:');
  }

  /** La fecha (YYYY-MM-DD) que lleva dentro una clave de cubo, viva o drenándose. */
  private static dateOfBucket(key: string): string | null {
    const parts = key.split(':');
    // imp:bucket:{fecha}[:draining:{token}]
    const date = parts[2];
    return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  }

  /** Hoy en UTC, como YYYY-MM-DD. UTC igual que `trackView`, para que las dos series
   *  diarias troceen el tiempo por el mismo sitio. */
  private static todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // ---------------------------------------------------------------------------
  // CAPTURA — lo que corre (fuera de) la petición de búsqueda
  // ---------------------------------------------------------------------------

  /**
   * Contabiliza el conjunto de anuncios de UNA respuesta de búsqueda servida.
   *
   * DEVUELVE `void` A PROPÓSITO (regla 1 de la cabecera): no hay promesa que esperar.
   * Y recibe los materiales EN CRUDO —la cabecera, la IP, el user-agent, la query— en
   * vez de un hash ya calculado, para que hasta el `sha256` ocurra fuera de la ruta
   * caliente.
   */
  recordServedResults(input: {
    /** Ids de los anuncios servidos, ya deduplicados y SIN el patrocinado. */
    listingIds: string[];
    /** `x-visitor-hash` reenviado por el BFF, si vino. Ver `resolveVisitorKey`. */
    forwardedVisitorHash?: string;
    /** IP que ve Nest. Para tráfico del BFF es la del servidor de Next — ver abajo. */
    ip?: string;
    userAgent?: string;
    /** Los query params tal cual llegaron: es lo que identifica «esta búsqueda». */
    query: Record<string, unknown>;
  }): void {
    if (input.listingIds.length === 0) return;

    // `setImmediate` Y NO UN `void promesa` A SECAS, y la diferencia es real: el cuerpo
    // de una función `async` corre SÍNCRONAMENTE hasta su primer `await`, en la pila de
    // quien la llama. Sin este aplazamiento, los dos `sha256` y la construcción de la
    // clave se ejecutarían dentro de la petición de búsqueda — poca cosa en
    // microsegundos, pero convierte «la búsqueda no paga nada» en «la búsqueda paga un
    // poco», que es una promesa distinta y más difícil de defender con el tiempo.
    //
    // Con él, la petición sólo paga esta llamada y el encolado de un callback; TODO lo
    // demás —hashing incluido— ocurre cuando la respuesta ya salió.
    setImmediate(() => {
      void this.accumulate(input).catch((err: unknown) => {
        // FAIL-OPEN (regla 2). El `catch` está aquí y no dentro para que ninguna rama de
        // `accumulate` pueda escaparse sin él.
        this.logger.warn(
          `No se pudo contabilizar la impresión de ${input.listingIds.length} anuncio(s): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    });
  }

  private async accumulate(input: {
    listingIds: string[];
    forwardedVisitorHash?: string;
    ip?: string;
    userAgent?: string;
    query: Record<string, unknown>;
  }): Promise<void> {
    const visitorKey = ImpressionsService.resolveVisitorKey(input);
    const queryKey = ImpressionsService.queryKey(input.query);

    // ── DEDUP POR BÚSQUEDA, NO POR ANUNCIO ──────────────────────────────────────
    //
    // UNA operación, no veinticuatro. El caso que hay que cortar es «el mismo visitante
    // repitiendo la misma búsqueda» —recargar, paginar y volver—, y eso es exactamente
    // una repetición de la MISMA búsqueda: se identifica con una sola clave.
    //
    // Un `SET NX` por anuncio (el calco literal de `trackView`) serían 24 claves y 24
    // operaciones por búsqueda, y ~24x la memoria en Redis, para responder peor: el
    // coste que se acepta con el dedup por búsqueda es que un anuncio que aparece en
    // DOS búsquedas distintas del mismo visitante cuente dos veces — y eso es correcto,
    // son dos apariciones distintas.
    const dedupKey = `imp:dedup:${visitorKey}:${queryKey}`;
    const accepted = await this.redis.client.set(
      dedupKey,
      '1',
      'EX',
      ImpressionsService.DEDUP_TTL_SECONDS,
      'NX',
    );
    if (accepted !== 'OK') return; // esta búsqueda de este visitante ya contó

    // ── EL ACUMULADOR ───────────────────────────────────────────────────────────
    //
    // Un `pipeline` = UN round-trip para los N anuncios, y N operaciones O(1) en
    // memoria. El dedup y esto NO van en el mismo pipeline (el diseño lo insinuaba)
    // porque el resultado del `SET NX` DECIDE si hay que incrementar: unirlos exigiría
    // un script Lua, y un round-trip de más en un camino que ya nadie espera no
    // justifica meter Lua en el repo.
    const bucket = ImpressionsService.liveBucket(ImpressionsService.todayUtc());
    const pipeline = this.redis.client.pipeline();
    for (const listingId of input.listingIds) {
      pipeline.hincrby(bucket, listingId, 1);
    }
    await pipeline.exec();
  }

  /**
   * QUIÉN ES EL VISITANTE, y por qué esto no es tan directo como en `trackView`.
   *
   * `/busqueda` y `/[categoria]` son Server Components: la llamada a `GET /search` la
   * hace **el servidor de Next**, no el navegador. Para Nest, todas las búsquedas del
   * mundo vienen entonces de la MISMA IP —la de Next—, así que el `sha256(ip:ua)` que
   * funciona en `trackView` (donde el llamador SÍ es el navegador) aquí colapsaría a
   * todos los visitantes en uno solo y el dedup mataría todo menos la primera búsqueda.
   *
   * Por eso el BFF reenvía la identidad en `x-visitor-hash` (ver
   * `apps/web/src/lib/visitor.ts`). Se re-hashea lo que venga en lugar de usarlo tal
   * cual: así la clave de Redis mide siempre 64 hex, venga la cabecera bien formada,
   * malformada o de un cliente que se la inventa.
   *
   * SIN cabecera se cae a `sha256(ip:ua)`, que para tráfico del BFF significa
   * sobre-deduplicar (todo el mundo es el mismo visitante). Es el fallo en la dirección
   * correcta: contar de menos, nunca de más.
   */
  private static resolveVisitorKey(input: {
    forwardedVisitorHash?: string;
    ip?: string;
    userAgent?: string;
  }): string {
    const material = input.forwardedVisitorHash?.trim()
      ? `fwd:${input.forwardedVisitorHash.trim()}`
      : `direct:${input.ip ?? ''}:${input.userAgent ?? ''}`;
    return createHash('sha256').update(material).digest('hex');
  }

  /**
   * La huella de «esta búsqueda»: los query params ORDENADOS y hasheados. Ordenados
   * porque `?q=x&page=2` y `?page=2&q=x` son la misma búsqueda; con `page` dentro
   * porque dos páginas distintas NO lo son (y cada una es una aparición distinta).
   */
  private static queryKey(query: Record<string, unknown>): string {
    const normalized = Object.entries(query)
      .map(([k, v]) => `${k}=${String(v)}`)
      .sort()
      .join('&');
    return createHash('sha256').update(normalized).digest('hex');
  }

  // ---------------------------------------------------------------------------
  // VOLCADO — lo que corre en el cron, lejos de cualquier petición
  // ---------------------------------------------------------------------------

  /**
   * Vuelca los acumuladores de Redis a `ListingImpressionDaily`.
   *
   * ─── EL DRENAJE ES ATÓMICO, Y ESA ES LA PIEZA CLAVE ──────────────────────────
   *
   * `RENAME` mueve el hash entero de una sola vez. Desde ese instante los `HINCRBY` de
   * las búsquedas que estén en vuelo crean un hash NUEVO y limpio, así que la ventana
   * entre «empiezo a volcar» y «termino» **no pierde un solo incremento**. Leer y luego
   * borrar (o leer y restar) sí los perdería.
   *
   * ─── Y ES IDEMPOTENTE ───────────────────────────────────────────────────────
   *
   * El nombre de destino lleva un token aleatorio, así que dos ciclos nunca se pisan.
   * Si el proceso muere entre el `RENAME` y el `DEL`, el hash renombrado SOBREVIVE, y
   * el `SCAN` del ciclo siguiente lo encuentra (comparte prefijo con el vivo) y lo
   * reintenta. La única pérdida posible es un doble conteo si muere entre la escritura
   * y el `DEL` — que es la dirección correcta del error para una métrica de vanidad.
   *
   * Público (y no sólo el `@Cron`) para poder dispararlo desde los tests sin esperar al
   * planificador — convención del repo, ver `InvoicingScheduleService` y
   * `EntitlementExpirationService`.
   */
  async flushImpressions(): Promise<{ buckets: number; listings: number }> {
    const keys = await this.scanBuckets();
    const toDrain: string[] = [];

    for (const key of keys) {
      if (ImpressionsService.isDraining(key)) {
        // Huérfano de un volcado anterior que no llegó a borrarlo. Se reintenta.
        toDrain.push(key);
        continue;
      }
      const date = ImpressionsService.dateOfBucket(key);
      if (!date) {
        this.logger.warn(`Cubo de impresiones con nombre ilegible, se ignora: ${key}`);
        continue;
      }
      const target = ImpressionsService.drainBucket(date, randomBytes(6).toString('hex'));
      try {
        await this.redis.client.rename(key, target);
        toDrain.push(target);
      } catch (err) {
        // La clave desapareció entre el SCAN y el RENAME (otro proceso la drenó, o
        // nunca llegó a existir). No hay nada que volcar: no es un error.
        this.logger.debug(
          `No se pudo renombrar ${key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    let listings = 0;
    for (const key of toDrain) {
      try {
        listings += await this.drainBucket(key);
      } catch (err) {
        // Un cubo que falla NO aborta los demás: el suyo se queda en Redis y el
        // siguiente ciclo lo reintenta. Molde de los barridos de expiración.
        this.logger.error(
          `Fallo volcando el cubo ${key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (toDrain.length > 0) {
      this.logger.log(
        `Impresiones: ${toDrain.length} cubo(s) volcado(s), ${listings} anuncio(s) actualizados`,
      );
    }
    return { buckets: toDrain.length, listings };
  }

  /** `SCAN` incremental (nunca `KEYS`, que bloquea Redis) sobre el prefijo de cubos. */
  private async scanBuckets(): Promise<string[]> {
    const found = new Set<string>();
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.client.scan(
        cursor,
        'MATCH',
        ImpressionsService.BUCKET_PATTERN,
        'COUNT',
        200,
      );
      for (const key of keys) found.add(key);
      cursor = next;
    } while (cursor !== '0');
    return [...found];
  }

  /** Lee un cubo ya renombrado, lo escribe en la BD y lo borra. Devuelve nº de anuncios. */
  private async drainBucket(key: string): Promise<number> {
    const date = ImpressionsService.dateOfBucket(key);
    if (!date) {
      this.logger.warn(`Cubo drenándose con fecha ilegible, se descarta: ${key}`);
      await this.redis.client.del(key);
      return 0;
    }

    const raw = await this.redis.client.hgetall(key);
    const entries: Array<[string, number]> = Object.entries(raw)
      .map(([listingId, value]) => [listingId, Number.parseInt(value, 10)] as [string, number])
      .filter(([, count]) => Number.isFinite(count) && count > 0);

    if (entries.length === 0) {
      await this.redis.client.del(key);
      return 0;
    }

    for (let i = 0; i < entries.length; i += ImpressionsService.CHUNK_SIZE) {
      await this.writeChunk(date, entries.slice(i, i + ImpressionsService.CHUNK_SIZE));
    }

    await this.redis.client.del(key);
    return entries.length;
  }

  /**
   * Escribe un trozo: la fila diaria y el total, EN UNA TRANSACCIÓN.
   *
   * ─── POR QUÉ SQL EN CRUDO Y NO N `upsert` DE PRISMA ─────────────────────────
   *
   * Porque `$transaction([...upserts])` es un round-trip POR ANUNCIO: con 5.000
   * anuncios en un cubo, 5.000 viajes. Aquí son DOS sentencias por trozo, sea cual sea
   * el tamaño del trozo. `Prisma.join` mantiene todo parametrizado — ni una
   * interpolación de texto.
   *
   * ─── POR QUÉ EL `JOIN "Listing"` ─────────────────────────────────────────────
   *
   * NO es adorno. Un anuncio puede haberse BORRADO entre la acumulación y el volcado
   * (hasta 15 minutos de ventana), y sin el `JOIN` la clave foránea abortaría el trozo
   * ENTERO por una sola fila muerta: un anuncio borrado tumbaría las impresiones de los
   * otros 499. Con él, la fila huérfana simplemente no casa y se cae sola.
   *
   * `gen_random_uuid()::text` para el `id`: la columna es `String @id @default(cuid())`
   * —molde de `ListingViewDaily`— pero el default de Prisma sólo se aplica cuando
   * escribe Prisma, y aquí escribe SQL. El id es un sustituto opaco (la clave real es
   * `(listingId, date)`), así que su formato da igual; `gen_random_uuid()` es nativo
   * desde PostgreSQL 13 y no necesita extensiones.
   */
  private async writeChunk(date: string, entries: Array<[string, number]>): Promise<void> {
    const dailyValues = Prisma.join(
      entries.map(([listingId, count]) => Prisma.sql`(${listingId}::text, ${count}::int)`),
    );

    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        INSERT INTO "ListingImpressionDaily" ("id", "listingId", "date", "count")
        SELECT gen_random_uuid()::text, v.listing_id, ${date}::date, v.count
        FROM (VALUES ${dailyValues}) AS v(listing_id, count)
        JOIN "Listing" l ON l.id = v.listing_id
        ON CONFLICT ("listingId", "date")
        DO UPDATE SET "count" = "ListingImpressionDaily"."count" + EXCLUDED."count"
      `,
      this.prisma.$executeRaw`
        UPDATE "Listing" l
        SET "impressionCount" = l."impressionCount" + v.count
        FROM (VALUES ${dailyValues}) AS v(listing_id, count)
        WHERE l.id = v.listing_id
      `,
    ]);
  }

  // ---------------------------------------------------------------------------
  // RETENCIÓN
  // ---------------------------------------------------------------------------

  /**
   * Purga la granularidad diaria de más de `RETENTION_DAYS`, en las DOS tablas.
   *
   * ─── POR QUÉ HACE FALTA AQUÍ Y NO HIZO FALTA ANTES ──────────────────────────
   *
   * `ListingViewDaily` lleva desde H8.C1 sin purgarse y aguanta porque sus filas son
   * ESCASAS: sólo existe fila los días en que alguien entró en la ficha.
   * `ListingImpressionDaily` es lo contrario —un anuncio activo sale en búsquedas casi
   * todos los días—, así que tiende a una fila por (anuncio × día) y crece sola para
   * siempre. Con 20.000 activos son ~7,3 M filas al año.
   *
   * ─── Y POR QUÉ SE PURGAN LAS DOS ────────────────────────────────────────────
   *
   * Porque son tablas gemelas que alimentan la MISMA gráfica. Purgar sólo la nueva
   * dejaría dos políticas distintas para dos series que se pintan juntas: la de vistas
   * llegaría a 2024 y la de impresiones se cortaría a los seis meses, en el mismo eje.
   *
   * PURGAR NO BORRA EL NÚMERO REDONDO: los totales viven en `Listing.viewCount` y
   * `Listing.impressionCount`, que no se tocan. Lo que se pierde es el detalle día a
   * día de hace más de medio año, que no se enseña en ninguna pantalla (el Pro ve 30
   * días; el backoffice de B.1 propondrá hasta 90).
   */
  async purgeOldDailyRows(): Promise<{ impressions: number; views: number }> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - ImpressionsService.RETENTION_DAYS);
    cutoff.setUTCHours(0, 0, 0, 0);

    const [impressions, views] = await this.prisma.$transaction([
      this.prisma.listingImpressionDaily.deleteMany({ where: { date: { lt: cutoff } } }),
      this.prisma.listingViewDaily.deleteMany({ where: { date: { lt: cutoff } } }),
    ]);

    if (impressions.count > 0 || views.count > 0) {
      this.logger.log(
        `Purga de telemetría diaria (> ${ImpressionsService.RETENTION_DAYS} días): ` +
          `${impressions.count} impresiones, ${views.count} vistas`,
      );
    }
    return { impressions: impressions.count, views: views.count };
  }
}
