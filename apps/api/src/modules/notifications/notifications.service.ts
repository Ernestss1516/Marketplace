import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  NotificationType,
  AlertMatchData,
  ContactMessageData,
  ReviewRequestData,
  InvoicingPendingFiscalDataData,
  TicketMessageData,
  TicketOpenedData,
  TicketStaffNewData,
  ReportResolvedData,
  ListingModeratedData,
  ReviewModeratedData,
  BumpAutoPausedData,
  DataExportReadyData,
  AccountModeratedData,
} from './notification.types';

/**
 * NOTIFICACIONES A1 — LA BARRERA QUE OBLIGA A REGISTRAR CADA TIPO.
 *
 * El único cometido de este alias es imponer la restricción a su argumento: si un
 * miembro de `NotificationType` no tiene entrada en el objeto de abajo, el
 * argumento incumple `Record<NotificationType, unknown>` y **el error salta ahí
 * mismo**, nombrando la clave que falta.
 *
 * Antes `DataByType` era un objeto suelto, sin nada que lo atara a
 * `NotificationType`. Por eso pudo convivir con un tipo —`DATA_EXPORT_READY`— que
 * no aparecía por aquí: no había nada que el compilador supiera exigir.
 */
type Snapshots<T extends Record<NotificationType, unknown>> = T;

/** Cada tipo con la forma EXACTA de su snapshot: es lo que impide que `type` y `data` se desalineen. */
type DataByType = Snapshots<{
  ALERT_MATCH: AlertMatchData;
  CONTACT_MESSAGE: ContactMessageData;
  REVIEW_REQUEST: ReviewRequestData;
  INVOICING_PENDING_FISCAL_DATA: InvoicingPendingFiscalDataData;
  TICKET_MESSAGE: TicketMessageData;
  TICKET_OPENED: TicketOpenedData;
  TICKET_STAFF_NEW: TicketStaffNewData;
  REPORT_RESOLVED: ReportResolvedData;
  LISTING_MODERATED: ListingModeratedData;
  REVIEW_MODERATED: ReviewModeratedData;
  BUMP_AUTO_PAUSED: BumpAutoPausedData;
  DATA_EXPORT_READY: DataExportReadyData;
  ACCOUNT_MODERATED: AccountModeratedData;
}>;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * LA ÚNICA PUERTA POR LA QUE SE CREA UNA `Notification`. Sin cola y sin efectos
   * colaterales: el llamante decide si además encola un email.
   *
   * ── LA BARRERA, Y HASTA DÓNDE LLEGA ─────────────────────────────────────────
   *
   * `DataByType[T]` empareja el `type` con su snapshot: un `data` con la forma de
   * otro tipo no compila, y desde A1 `DataByType` está además obligado a cubrir
   * `NotificationType` entero (ver `Snapshots`), así que un tipo nuevo tampoco
   * puede existir sin declarar su forma.
   *
   * Lo que esa barrera NO puede hacer por sí sola es impedir que alguien la rodee
   * con `prisma.notification.create()`, que es lo que pasó dos veces
   * (`INVOICING_PENDING_FISCAL_DATA` y `DATA_EXPORT_READY`, los dos avisos que
   * acabaron saliendo como «Nueva notificación»).
   *
   * SE INTENTÓ CERRARLO EN EL TIPO Y NO SE PUEDE: `PrismaClient` declara
   * `notification` como *accessor*, y TypeScript rechaza redeclararlo en una
   * subclase con cualquier forma de propiedad (TS2610) — comprobado con `declare`,
   * con `readonly` y por fusión de interfaz. Sustituirlo por un getter tampoco
   * vale: Prisma crea los delegates como propiedades **de instancia**, así que
   * `super.notification` sería `undefined` en ejecución.
   *
   * La barrera vive por tanto donde sí es efectiva y no se puede ignorar:
   * `notifications-puerta-unica.spec.ts`, aquí al lado, que recorre el código y
   * falla si aparece una creación de `Notification` fuera de este método. No es el
   * compilador, pero cumple la propiedad que importa: **no se puede fusionar el
   * olvido**.
   */
  async createNotification<T extends NotificationType>(
    userId: string,
    type: T,
    data: DataByType[T],
  ): Promise<void> {
    await this.prisma.notification.create({
      data: { userId, type, data: data as unknown as Prisma.InputJsonValue },
    });
  }

  async findByUser(userId: string, page: number, perPage: number) {
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);
    return { items, total, page, perPage, pages: Math.ceil(total / perPage) };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, read: false } });
  }

  /** Scoped by userId, not just id — never trusts the :id param alone. Idempotent
   * either way: already-read or belonging to someone else both match 0 rows. */
  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, userId, read: false },
      data: { read: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });
  }
}
