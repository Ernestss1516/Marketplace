import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { computeCtr } from '../listings/listing-ctr';
import { LIKE_RATIO_MIN_VIEWS, ratioWithMinSample } from '../listings/sample-threshold';
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
  constructor(private readonly prisma: PrismaService) {}

  /** El primer día de la ventana, normalizado a medianoche UTC como las tablas diarias. */
  private static since(days: StatsRangeDays): Date {
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

  /** `groupBy` devuelve `_sum.count` anulable; la serie que sale de aquí nunca lo es. */
  private static toSeries(
    rows: Array<{ date: Date; _sum: { count: number | null } }>,
  ): Array<{ date: Date; count: number }> {
    return rows.map((fila) => ({ date: fila.date, count: fila._sum.count ?? 0 }));
  }
}
