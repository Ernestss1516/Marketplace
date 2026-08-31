import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { ListingLifecycleNotificationsService } from '../listing-lifecycle-notifications/listing-lifecycle-notifications.service';

/**
 * NOTIFICACIONES N3 — CUÁNTOS DÍAS ANTES SE PREAVISA.
 *
 * SIETE, y la elección importa por los dos lados: con menos, avisar a alguien que
 * entra una vez por semana llega tarde; con más, el aviso cae tan lejos del
 * vencimiento que se olvida antes de que sirva de nada. Una semana es el margen en
 * el que «lo renuevo luego» todavía cabe.
 *
 * SIGUE SIENDO CONSTANTE, y ahora es una asimetría deliberada: su pareja —el plazo
 * de caducidad— **ya sí es configurable** (`ListingExpiryService`, que lee el
 * `Setting` `listingExpiryDays`). El preaviso no se ha movido con ella porque no
 * hace falta y porque tendría filo: es un número que sólo tiene sentido POR DEBAJO
 * del plazo, y dos ajustes que se pueden cruzar exigen una invariante que
 * vigilarlos (como la de `total > activos` o la de `min ≤ max` de fotos).
 *
 * LO QUE SÍ PASA AL BAJAR MUCHO EL PLAZO: con una caducidad de 7 días o menos, todo
 * anuncio nace ya dentro de la ventana de preaviso y se le avisa casi al publicarlo.
 * No rompe nada —la marca `expiryWarnedFor` sigue evitando el aviso repetido— pero
 * es ruido, y por eso la descripción del ajuste en el backoffice lo dice y recomienda
 * un rango por encima de la semana.
 */
const EXPIRY_WARNING_DAYS = 7;

const cacheKey = (slug: string) => `listing:${slug}`;

@Injectable()
export class ExpirationService {
  private readonly logger = new Logger(ExpirationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    // N3 — caducar y preavisar dejan de ser mudos.
    private readonly lifecycleNotify: ListingLifecycleNotificationsService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
  ) {}

  // Runs daily at 02:00. RESERVED listings are intentionally excluded: a
  // reserved listing is in active negotiation and must not expire automatically.
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async expireListings(): Promise<void> {
    const now = new Date();

    const expired = await this.prisma.listing.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      // N3 — `title` y `sellerId` entran en el `select` para poder avisar sin una
      // segunda consulta por anuncio.
      select: { id: true, slug: true, title: true, sellerId: true },
    });

    if (expired.length === 0) return;

    await this.prisma.listing.updateMany({
      where: { id: { in: expired.map((l) => l.id) } },
      data: { status: 'EXPIRED' },
    });

    await Promise.all(
      expired.map(async ({ id, slug }) => {
        await this.redis.client.del(cacheKey(slug));
        await this.indexingQueue.add('index', { listingId: id });
      }),
    );

    /**
     * NOTIFICACIONES N3 — EL AVISO QUE MÁS FALTA HACÍA, y va DESPUÉS de persistir.
     *
     * Hasta aquí el anuncio salía del marketplace por su cuenta y su dueño no se
     * enteraba: es literalmente el caso «desapareció y no sé por qué». Y no lo ha
     * retirado nadie —el copy lo dice— porque lo primero que piensa quien no
     * encuentra su anuncio es que se lo han quitado.
     *
     * Cada aviso va en su propio `try`: **una barrida de N anuncios no puede
     * abortarse porque el aviso del tercero falle**. Los anuncios ya están
     * caducados y reindexados, que es lo que importa; un aviso perdido es un aviso
     * perdido. Mismo criterio que el `try/catch` por anuncio de
     * `expireFeaturedListings`.
     */
    for (const listing of expired) {
      try {
        await this.lifecycleNotify.ocurrio(listing, 'EXPIRED');
      } catch (err) {
        this.logger.error(`No se pudo avisar de la caducidad de ${listing.id}`, err);
      }
    }

    this.logger.log(`Expired ${expired.length} listing(s).`);
  }

  /**
   * NOTIFICACIONES N3 — EL PREAVISO: «tu anuncio caduca dentro de N días».
   *
   * ── CRON HERMANO Y NO UNA LÍNEA MÁS EN EL DE ARRIBA ────────────────────────
   *
   * Mismo criterio que separó el de entitlements (03:00) del de anuncios (02:00) y
   * el de suspensiones (07:00): **que el fallo de una barrida no bloquee la otra**.
   * Aquí importa especialmente por el orden — si el preaviso reventara dentro del
   * cron de las 02:00, se llevaría por delante la caducidad, que es lo que de
   * verdad no puede dejar de correr.
   *
   * 02:30 porque las horas en punto de la franja 02:00–07:00 ya están ocupadas.
   *
   * ── LA IDEMPOTENCIA, QUE ES TODA LA DIFICULTAD ────────────────────────────
   *
   * La ventana «expira dentro de 7 días» la cumple el mismo anuncio SIETE DÍAS
   * SEGUIDOS. Sin marca, el cron diario le manda siete avisos idénticos y siete
   * correos: convertiría el preaviso en la razón para desactivar los avisos.
   *
   * La marca es `expiryWarnedFor`, que guarda **el vencimiento contra el que se
   * avisó**, no un «ya avisé». Ver el comentario del campo en `schema.prisma`: es
   * lo que hace que renovar reabra el preaviso sin que nadie tenga que limpiar
   * nada en los cinco sitios que escriben `expiresAt`.
   *
   * Se marca DESPUÉS de avisar y sólo si el aviso salió: si falla, mañana se
   * reintenta. Al revés se perdería el aviso para siempre.
   */
  @Cron('30 2 * * *')
  async warnExpiringListings(): Promise<void> {
    const now = new Date();
    const limite = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);

    const porCaducar = await this.prisma.listing.findMany({
      where: {
        status: 'ACTIVE',
        // `gt: now` y no `gte`: lo que ya venció es trabajo del cron de las 02:00,
        // y preavisar de algo caducado sería avisar tarde y además dos veces.
        expiresAt: { gt: now, lte: limite },
      },
      select: { id: true, title: true, sellerId: true, expiresAt: true, expiryWarnedFor: true },
    });

    let avisados = 0;
    for (const listing of porCaducar) {
      if (!listing.expiresAt) continue;

      // LA IDEMPOTENCIA. `expiryWarnedFor === expiresAt` significa «de ESTE
      // vencimiento ya se avisó». Comparado por valor y no por presencia: tras una
      // renovación el vencimiento es otro y vuelve a ser preavisable.
      if (listing.expiryWarnedFor?.getTime() === listing.expiresAt.getTime()) continue;

      const diasRestantes = Math.max(
        1,
        Math.ceil((listing.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      );

      try {
        await this.lifecycleNotify.ocurrio(listing, 'EXPIRING_SOON', { daysLeft: diasRestantes });
        await this.prisma.listing.update({
          where: { id: listing.id },
          data: { expiryWarnedFor: listing.expiresAt },
        });
        avisados++;
      } catch (err) {
        // Sin marcar: mañana se reintenta. Un aviso que no salió no debe quedar
        // registrado como enviado.
        this.logger.error(`No se pudo preavisar de la caducidad de ${listing.id}`, err);
      }
    }

    if (avisados > 0) {
      this.logger.log(
        `Preaviso de caducidad: ${avisados}/${porCaducar.length} anuncio(s) avisado(s) ` +
          `(${EXPIRY_WARNING_DAYS} días).`,
      );
    }
  }

  /**
   * `static expiresAt(from)` VIVÍA AQUÍ Y SE HA ELIMINADO.
   *
   * Calculaba el vencimiento con una constante `EXPIRY_DAYS = 60` clavada, y por eso el
   * `Setting` `listingExpiryDays` llevaba desde el MVP sembrado, editable y sin efecto: un
   * método estático no tiene inyección, así que no podía leer nada. Ahora lo hace
   * `ListingExpiryService.expiresAt()`, que sí lee el ajuste.
   *
   * NO SE HA DEJADO COMO ATAJO, a propósito: mientras existiera, cualquiera podría volver a
   * llamarlo sin darse cuenta y el ajuste volvería a mentir en silencio, sin que ningún test
   * pudiera notarlo. Quitarlo convierte esa regresión en un error de compilación.
   */
}
