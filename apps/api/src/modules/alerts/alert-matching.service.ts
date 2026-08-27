import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CUENTA_EN_ESCAPARATE } from '../users/account-visibility';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QUEUE_NOTIFICATIONS } from '../../infra/queue/queue.constants';
import { NOTIFICATION_JOB, SendAlertEmailData } from '../../infra/queue/notification.types';
import { isP2002 } from '../../common/prisma/is-p2002';
import { alertToSearchParams } from './alert-to-search-params';

@Injectable()
export class AlertMatchingService {
  private readonly logger = new Logger(AlertMatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly searchService: SearchService,
    private readonly notificationsService: NotificationsService,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly notificationQueue: Queue,
  ) {}

  /**
   * Called only after IndexingProcessor has confirmed (waitForTask) that
   * `listingId` is queryable in Meilisearch and still ACTIVE — see
   * listing-activation.service.ts / indexing.processor.ts. No race with the
   * index write by construction.
   */
  async matchListing(listingId: string): Promise<void> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { category: { select: { slug: true } } },
    });
    // Defensive: the listing may have left ACTIVE again (or been deleted)
    // between the indexing job finishing and this job running.
    if (!listing || listing.status !== 'ACTIVE') return;

    // Fase 1 — SQL pre-filter: safe over-approximation. Only the columns that
    // can be compared exactly in SQL are checked (null on the alert = no
    // constraint on that field). `attributes`, `q` and geo are deliberately
    // NOT filtered here — Fase 2 (Meilisearch) evaluates them with the same
    // semantics search() uses, instead of a second, divergent implementation.
    const candidates = await this.prisma.alert.findMany({
      where: {
        active: true,
        /**
         * BORRADO DE CUENTAS C2 (§4.5) — NO se notifica a una cuenta cerrada.
         *
         * UNA CONDICIÓN EN LA CONSULTA, Y NO APAGAR LAS ALERTAS UNA A UNA al
         * archivar. La diferencia no es de esfuerzo: apagarlas obligaría a
         * recordar CUÁLES estaban activas para poder devolverlas al desarchivar
         * —otro marcador como `pausedByAccountReason`—, y a acertar en los dos
         * lados. Aquí no hay estado que restaurar: la cuenta vuelve y sus alertas
         * vuelven con ella, porque nunca se tocaron.
         *
         * BORRADO DE CUENTAS C3 — ESTA CONDICIÓN NACIÓ AQUÍ EN C2, escrita a mano
         * como `notIn: [ARCHIVED, DELETED, BANNED]`. Pasa a la constante
         * compartida, que dice exactamente lo mismo por el otro lado
         * (`in: [ACTIVE, SUSPENDED]`) — y es el sitio donde más falta hace: era
         * la única copia suelta del predicado, o sea la que se habría quedado
         * atrás el día que la lista de estados cambie.
         *
         * A un SUSPENDED se le sigue guardando su correspondencia: la suspensión
         * es temporal y reversible.
         */
        user: CUENTA_EN_ESCAPARATE,
        AND: [
          { OR: [{ categorySlug: null }, { categorySlug: listing.category.slug }] },
          { OR: [{ type: null }, { type: listing.type }] },
          { OR: [{ condition: null }, { condition: listing.condition }] },
          { OR: [{ priceType: null }, { priceType: listing.priceType }] },
          { OR: [{ minPrice: null }, { minPrice: { lte: listing.price } }] },
          { OR: [{ maxPrice: null }, { maxPrice: { gte: listing.price } }] },
          { OR: [{ province: null }, { province: listing.province }] },
          { OR: [{ city: null }, { city: listing.city }] },
        ],
      },
      include: { user: { select: { email: true, name: true } } },
    });

    for (const alert of candidates) {
      // Fase 2 — confirm with real search semantics (ruta A): "is this exact
      // listing among the alert's search results?" instead of re-implementing
      // attribute/geo filtering in JS.
      const result = await this.searchService.search({
        ...alertToSearchParams(alert),
        listingId,
        hitsPerPage: 1,
      });
      if (result.hits.length === 0) continue;

      try {
        // @@unique([alertId, listingId]) — throws P2002 if this pair was
        // already notified (e.g. a previous publish, or a retried job).
        await this.prisma.alertMatch.create({ data: { alertId: alert.id, listingId } });
      } catch (err) {
        if (isP2002(err)) continue;
        throw err;
      }

      await this.notificationsService.createNotification(alert.userId, 'ALERT_MATCH', {
        alertId: alert.id,
        alertName: alert.name,
        listingId,
        listingSlug: listing.slug,
        listingTitle: listing.title,
      });

      // In-app and email are two independent dispatches — a failure in one
      // must not block the other (same principle as B1's design).
      await this.notificationQueue.add(NOTIFICATION_JOB.SEND_ALERT_EMAIL, {
        email: alert.user.email,
        name: alert.user.name,
        alertName: alert.name,
        listingTitle: listing.title,
        listingSlug: listing.slug,
      } satisfies SendAlertEmailData);

      this.logger.debug(`Alert ${alert.id} matched listing ${listingId}`);
    }
  }
}
