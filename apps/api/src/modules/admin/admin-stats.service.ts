import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { computeCtr, CTR_MIN_IMPRESSIONS } from '../listings/listing-ctr';
import { LIKE_RATIO_MIN_VIEWS, ratioWithMinSample } from '../listings/sample-threshold';
import {
  CategoryTreeService,
  ancestorChainIn,
  descendantIdsIn,
} from '../categories/category-tree.service';
import type { StatsRangeDays } from './dto/stats-range.dto';

/**
 * ESTADÍSTICAS B1 — LA TELEMETRÍA, LEÍDA POR EL STAFF.
 *
 * ─── ESTE SERVICIO NO CUENTA NADA ────────────────────────────────────────────────
 *
 * No hay aquí ni un `INCR`, ni un `upsert`, ni una tabla propia: **sólo lee**
 * `ListingViewDaily` y `ListingImpressionDaily`, que son exactamente las mismas dos tablas
 * que llenan `trackView` (H8.C1) y el volcado de impresiones (A1), y las mismas que sirve
 * el panel del vendedor Pro (A2). Una captura, dos audiencias — el requisito central del
 * encargo de estadísticas (docs/diseno-estadisticas.md §4.1).
 *
 * Si algún día hiciera falta contar algo más, se añade a la captura; nunca aquí.
 *
 * ─── LAS AGREGACIONES SON CONSULTAS, NO TABLAS ───────────────────────────────────
 *
 * «La actividad de un usuario» es un `GROUP BY date` sobre las MISMAS filas diarias,
 * filtradas por `listing.sellerId`. No hay una `UserActivityDaily`, y no la habrá: una
 * tabla de agregado por eje sería una SEGUNDA fuente de verdad capaz de desviarse de la
 * primera —y habría que mantener una por cada eje que el backoffice quiera mirar (usuario,
 * categoría, plataforma)—. Si una de estas consultas no aguantara, la respuesta es
 * cachearla, no materializarla (§4.2 del diseño).
 *
 * ─── Y NO HAY GATE PRO ───────────────────────────────────────────────────────────
 *
 * El del vendedor mira SU anuncio y paga por la gráfica; el staff mira CUALQUIERA y no
 * paga nada. Lo que gobierna el acceso aquí es el piso de rol del controlador, no un
 * `isProActive`.
 */
@Injectable()
export class AdminStatsService {
  constructor(
    private readonly prisma: PrismaService,
    // B.3/B.4 — la MISMA foto memoizada del árbol que usa la búsqueda. `AdminModule` ya
    // importaba `CategoryTreeModule`, así que no hay dependencia nueva.
    private readonly categoryTree: CategoryTreeService,
  ) {}

  /**
   * El primer día de la ventana, normalizado a medianoche UTC como las tablas diarias.
   *
   * Acepta un `number` y no sólo `StatsRangeDays` porque el pulso de plataforma pide el
   * DOBLE de la ventana para poder calcular la delta contra el periodo anterior — y 180
   * no es uno de los tres valores que la interfaz ofrece.
   */
  private static since(days: number): Date {
    const desde = new Date();
    desde.setUTCDate(desde.getUTCDate() - days);
    desde.setUTCHours(0, 0, 0, 0);
    return desde;
  }

  // ---------------------------------------------------------------------------
  // B.1 — un anuncio
  // ---------------------------------------------------------------------------

  async listingActivity(id: string, days: StatsRangeDays) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, title: true, viewCount: true, impressionCount: true },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');

    const since = AdminStatsService.since(days);

    const [dailyViews, dailyImpressions, favoritesCount] = await Promise.all([
      this.prisma.listingViewDaily.findMany({
        where: { listingId: id, date: { gte: since } },
        orderBy: { date: 'asc' },
        select: { date: true, count: true },
      }),
      this.prisma.listingImpressionDaily.findMany({
        where: { listingId: id, date: { gte: since } },
        orderBy: { date: 'asc' },
        select: { date: true, count: true },
      }),
      this.prisma.favorite.count({ where: { listingId: id } }),
    ]);

    return {
      days,
      title: listing.title,
      viewCount: listing.viewCount,
      impressionCount: listing.impressionCount,
      favoritesCount,
      dailyViews,
      dailyImpressions,
      // LOS MISMOS RATIOS Y EL MISMO UMBRAL QUE VE EL VENDEDOR. El staff no necesita menos
      // honestidad que el dueño: un «100%» sobre tres apariciones engaña igual a quien
      // modera que a quien vende, y encima aquí se usa para decidir sobre anuncios ajenos.
      ctr: computeCtr(dailyViews, dailyImpressions),
      likeRatio: {
        value: ratioWithMinSample(favoritesCount, listing.viewCount, LIKE_RATIO_MIN_VIEWS),
        favorites: favoritesCount,
        views: listing.viewCount,
        minViews: LIKE_RATIO_MIN_VIEWS,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // B.2 — el conjunto de anuncios de un usuario
  // ---------------------------------------------------------------------------

  async userActivity(id: string, days: StatsRangeDays) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const since = AdminStatsService.since(days);

    // TODOS sus anuncios, sea cual sea su estado — no sólo los ACTIVE. La pregunta del
    // staff es «¿qué actividad genera esta persona?», y un anuncio archivado que acumuló
    // 40.000 visitas la semana pasada es exactamente lo que se está buscando.
    const where = { listing: { sellerId: id } };

    const [totales, dailyViewRows, dailyImpressionRows, favoritesCount, masVisto, masListado] =
      await Promise.all([
        this.prisma.listing.aggregate({
          where: { sellerId: id },
          _sum: { viewCount: true, impressionCount: true },
          _count: true,
        }),
        // LA AGREGACIÓN: una fila por fecha, sumando los anuncios del vendedor. Es la
        // consulta que sustituye a la tabla de agregado que NO se crea.
        this.prisma.listingViewDaily.groupBy({
          by: ['date'],
          where: { ...where, date: { gte: since } },
          _sum: { count: true },
          orderBy: { date: 'asc' },
        }),
        this.prisma.listingImpressionDaily.groupBy({
          by: ['date'],
          where: { ...where, date: { gte: since } },
          _sum: { count: true },
          orderBy: { date: 'asc' },
        }),
        this.prisma.favorite.count({ where }),
        // El más visto y el más listado, con `take: 1` en vez de traerse los N anuncios
        // del vendedor a memoria para hacer un `reduce`: un vendedor profesional puede
        // tener miles.
        this.prisma.listing.findFirst({
          where: { sellerId: id },
          orderBy: { viewCount: 'desc' },
          select: { id: true, title: true, viewCount: true },
        }),
        this.prisma.listing.findFirst({
          where: { sellerId: id },
          orderBy: { impressionCount: 'desc' },
          select: { id: true, title: true, impressionCount: true },
        }),
      ]);

    const dailyViews = AdminStatsService.toSeries(dailyViewRows);
    const dailyImpressions = AdminStatsService.toSeries(dailyImpressionRows);
    const viewCount = totales._sum.viewCount ?? 0;

    return {
      days,
      name: user.name,
      listingCount: totales._count,
      viewCount,
      impressionCount: totales._sum.impressionCount ?? 0,
      favoritesCount,
      dailyViews,
      dailyImpressions,
      ctr: computeCtr(dailyViews, dailyImpressions),
      likeRatio: {
        value: ratioWithMinSample(favoritesCount, viewCount, LIKE_RATIO_MIN_VIEWS),
        favorites: favoritesCount,
        views: viewCount,
        minViews: LIKE_RATIO_MIN_VIEWS,
      },
      // Con enlace desde la pantalla del usuario a la del anuncio: lo que convierte la
      // ficha en un punto de partida y no en un callejón.
      mostViewed: masVisto,
      mostListed: masListado,
    };
  }

  // ---------------------------------------------------------------------------
  // B.3 — el conjunto de anuncios de una categoría
  // ---------------------------------------------------------------------------

  /**
   * ─── LA JERARQUÍA: POR DEFECTO SE AGREGA EL SUBÁRBOL ─────────────────────────
   *
   * `Listing.categoryId` apunta SIEMPRE a la hoja donde se publicó. Así que
   * «Vehículos» sin subárbol daría casi cero mientras «Coches» se lo lleva todo — una
   * lectura falsa del pulso, no un matiz. Por eso `subtree` nace en `true`.
   *
   * Pero las dos cifras existen y el staff puede pedir cualquiera (`?subtree=false`),
   * porque cada una responde a una pregunta distinta: «¿cuánto mueve esta rama?» y
   * «¿cuánto mueve esta categoría concreta?». Enseñar sólo una miente en la mitad de los
   * casos.
   *
   * El subárbol sale de la MISMA foto memoizada del árbol que usa la búsqueda
   * (`CategoryTreeService`), no de una consulta recursiva propia.
   */
  async categoryActivity(id: string, days: StatsRangeDays, subtree: boolean) {
    const arbol = await this.categoryTree.getSnapshot();
    const categoria = arbol.get(id);
    if (!categoria) throw new NotFoundException('Categoría no encontrada');

    const descendientes = descendantIdsIn(arbol, id);
    const ids = subtree ? [id, ...descendientes] : [id];
    const since = AdminStatsService.since(days);
    const where = { listing: { categoryId: { in: ids } } };

    const [totales, dailyViewRows, dailyImpressionRows, favoritesCount, masVisto, masListado] =
      await Promise.all([
        this.prisma.listing.aggregate({
          where: { categoryId: { in: ids } },
          _sum: { viewCount: true, impressionCount: true },
          _count: true,
        }),
        this.prisma.listingViewDaily.groupBy({
          by: ['date'],
          where: { ...where, date: { gte: since } },
          _sum: { count: true },
          orderBy: { date: 'asc' },
        }),
        this.prisma.listingImpressionDaily.groupBy({
          by: ['date'],
          where: { ...where, date: { gte: since } },
          _sum: { count: true },
          orderBy: { date: 'asc' },
        }),
        this.prisma.favorite.count({ where }),
        this.prisma.listing.findFirst({
          where: { categoryId: { in: ids } },
          orderBy: { viewCount: 'desc' },
          select: { id: true, title: true, viewCount: true },
        }),
        this.prisma.listing.findFirst({
          where: { categoryId: { in: ids } },
          orderBy: { impressionCount: 'desc' },
          select: { id: true, title: true, impressionCount: true },
        }),
      ]);

    const dailyViews = AdminStatsService.toSeries(dailyViewRows);
    const dailyImpressions = AdminStatsService.toSeries(dailyImpressionRows);
    const viewCount = totales._sum.viewCount ?? 0;

    return {
      days,
      name: categoria.name,
      slug: categoria.slug,
      subtree,
      /** Cuántas subcategorías se están sumando — para poder decirlo en la interfaz. */
      descendantCount: descendientes.length,
      listingCount: totales._count,
      viewCount,
      impressionCount: totales._sum.impressionCount ?? 0,
      favoritesCount,
      dailyViews,
      dailyImpressions,
      ctr: computeCtr(dailyViews, dailyImpressions),
      likeRatio: {
        value: ratioWithMinSample(favoritesCount, viewCount, LIKE_RATIO_MIN_VIEWS),
        favorites: favoritesCount,
        views: viewCount,
        minViews: LIKE_RATIO_MIN_VIEWS,
      },
      mostViewed: masVisto,
      mostListed: masListado,
    };
  }

  // ---------------------------------------------------------------------------
  // B.4 — el pulso de la plataforma
  // ---------------------------------------------------------------------------

  /**
   * ─── UNA CONSULTA POR TABLA, NO DOS NI VEINTE ────────────────────────────────
   *
   * Esta pantalla necesita cuatro cosas: los totales por categoría del periodo, los del
   * periodo ANTERIOR (para la delta), la serie diaria de toda la plataforma, y el
   * desglose por hijas. La forma ingenua serían cuatro rondas de consultas.
   *
   * En su lugar se pide **una sola agregación por tabla** sobre una ventana del DOBLE de
   * ancho, agrupada por `(categoría, fecha)`. De esas filas salen las cuatro cosas
   * plegando en memoria — y el resultado es diminuto: categorías × días (decenas × 60),
   * no anuncios × días.
   *
   * ─── POR QUÉ SQL EN CRUDO ────────────────────────────────────────────────────
   *
   * Porque `categoryId` no es columna de las tablas diarias, sino de `Listing`, y el
   * `groupBy` de Prisma sólo agrupa por columnas del propio modelo. La alternativa
   * —agrupar por `listingId` y plegar en JS— traería anuncios × días: cientos de miles de
   * filas para producir cincuenta.
   *
   * ─── EL PLIEGUE POR JERARQUÍA ────────────────────────────────────────────────
   *
   * Cada fila trae la categoría HOJA donde se publicó el anuncio. Se suma a esa categoría
   * **y a todos sus ancestros**, con la foto memoizada del árbol: así una raíz enseña lo
   * que mueve su rama entera y no un casi-cero. Es el mismo criterio que `categoryPath`
   * en la búsqueda.
   */
  async platformPulse(days: StatsRangeDays) {
    const arbol = await this.categoryTree.getSnapshot();
    const desdeActual = AdminStatsService.since(days);
    const desdeAnterior = AdminStatsService.since(days * 2);

    const [vistas, impresiones, activosPorCategoria] = await Promise.all([
      this.aggregateByCategoryAndDate('ListingViewDaily', desdeAnterior),
      this.aggregateByCategoryAndDate('ListingImpressionDaily', desdeAnterior),
      this.prisma.listing.groupBy({
        by: ['categoryId'],
        where: { status: 'ACTIVE' },
        _count: true,
      }),
    ]);

    // Acumuladores por categoría (ya plegados hacia los ancestros) y la serie global.
    const porCategoria = new Map<string, Acumulado>();
    const serieVistas = new Map<string, number>();
    const serieImpresiones = new Map<string, number>();

    const acumular = (
      filas: FilaAgregada[],
      campo: 'views' | 'impressions',
      serie: Map<string, number>,
    ) => {
      for (const fila of filas) {
        const actual = fila.date >= desdeActual;
        if (actual) {
          const clave = fila.date.toISOString().slice(0, 10);
          serie.set(clave, (serie.get(clave) ?? 0) + fila.total);
        }
        // A la categoría del anuncio Y a todos sus ancestros.
        for (const nodo of ancestorChainIn(arbol, fila.categoryId)) {
          const acc = porCategoria.get(nodo.id) ?? AdminStatsService.acumuladoVacio();
          acc[actual ? campo : (`prev${campo === 'views' ? 'Views' : 'Impressions'}` as const)] +=
            fila.total;
          porCategoria.set(nodo.id, acc);
        }
      }
    };

    acumular(vistas, 'views', serieVistas);
    acumular(impresiones, 'impressions', serieImpresiones);

    // Los anuncios activos se pliegan igual: una raíz cuenta los de toda su rama.
    const activos = new Map<string, number>();
    for (const fila of activosPorCategoria) {
      for (const nodo of ancestorChainIn(arbol, fila.categoryId)) {
        activos.set(nodo.id, (activos.get(nodo.id) ?? 0) + fila._count);
      }
    }

    const fila = (nodo: { id: string; name: string; slug: string }) => {
      const acc = porCategoria.get(nodo.id) ?? AdminStatsService.acumuladoVacio();
      return {
        id: nodo.id,
        name: nodo.name,
        slug: nodo.slug,
        activeListings: activos.get(nodo.id) ?? 0,
        views: acc.views,
        impressions: acc.impressions,
        ctr: ratioWithMinSample(acc.views, acc.impressions, CTR_MIN_IMPRESSIONS),
        ctrMinImpressions: CTR_MIN_IMPRESSIONS,
        // `null` cuando el periodo anterior fue cero: «infinito %» no es una delta, y un
        // 0 % diría que no ha cambiado nada cuando ha cambiado todo.
        viewsDelta: acc.prevViews > 0 ? (acc.views - acc.prevViews) / acc.prevViews : null,
        impressionsDelta:
          acc.prevImpressions > 0
            ? (acc.impressions - acc.prevImpressions) / acc.prevImpressions
            : null,
      };
    };

    const nodos = [...arbol.values()];
    const categories = nodos
      .filter((n) => n.parentId === null)
      .map((raiz) => ({
        ...fila(raiz),
        // El desglose sale GRATIS de lo ya plegado: ni una consulta más.
        children: nodos
          .filter((n) => n.parentId === raiz.id)
          .map(fila)
          .sort((a, b) => b.views - a.views),
      }))
      .sort((a, b) => b.views - a.views);

    const totalViews = [...serieVistas.values()].reduce((s, n) => s + n, 0);
    const totalImpressions = [...serieImpresiones.values()].reduce((s, n) => s + n, 0);

    return {
      days,
      totals: {
        views: totalViews,
        impressions: totalImpressions,
        activeListings: activosPorCategoria.reduce((s, f) => s + f._count, 0),
        ctr: ratioWithMinSample(totalViews, totalImpressions, CTR_MIN_IMPRESSIONS),
        ctrMinImpressions: CTR_MIN_IMPRESSIONS,
      },
      // Series SUELTAS, no fusionadas: `StatsChart` las une (ver §3.1 del diseño, revisado
      // al implementar B1). Devolverlas fusionadas obligaría a partirlas para pintarlas.
      dailyViews: AdminStatsService.mapaASerie(serieVistas),
      dailyImpressions: AdminStatsService.mapaASerie(serieImpresiones),
      categories,
    };
  }

  /**
   * La agregación `(categoría, fecha)` de una tabla diaria.
   *
   * `Prisma.raw` interpola el nombre de la tabla, que es lo ÚNICO que no puede ir
   * parametrizado en SQL. No hay superficie de inyección: el parámetro es una unión de
   * dos literales de tipo, así que TypeScript impide que llegue aquí cualquier otra cosa,
   * y ningún valor de la petición alcanza este punto. La fecha sí va parametrizada.
   */
  private async aggregateByCategoryAndDate(
    tabla: 'ListingViewDaily' | 'ListingImpressionDaily',
    desde: Date,
  ): Promise<FilaAgregada[]> {
    return this.prisma.$queryRaw<FilaAgregada[]>`
      SELECT l."categoryId" AS "categoryId", d."date" AS "date", SUM(d."count")::int AS "total"
      FROM ${Prisma.raw(`"${tabla}"`)} d
      JOIN "Listing" l ON l.id = d."listingId"
      WHERE d."date" >= ${desde}
      GROUP BY l."categoryId", d."date"
    `;
  }

  private static acumuladoVacio(): Acumulado {
    return { views: 0, impressions: 0, prevViews: 0, prevImpressions: 0 };
  }

  private static mapaASerie(mapa: Map<string, number>): Array<{ date: string; count: number }> {
    return [...mapa.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** `groupBy` devuelve `_sum.count` anulable; la serie que sale de aquí nunca lo es. */
  private static toSeries(
    rows: Array<{ date: Date; _sum: { count: number | null } }>,
  ): Array<{ date: Date; count: number }> {
    return rows.map((fila) => ({ date: fila.date, count: fila._sum.count ?? 0 }));
  }
}

interface FilaAgregada {
  categoryId: string;
  date: Date;
  total: number;
}

interface Acumulado {
  views: number;
  impressions: number;
  prevViews: number;
  prevImpressions: number;
}
