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
  ListingLifecycleData,
  ReviewReceivedData,
  MessageUnreadData,
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
  LISTING_LIFECYCLE: ListingLifecycleData;
  REVIEW_RECEIVED: ReviewReceivedData;
  MESSAGE_UNREAD: MessageUnreadData;
}>;

/**
 * Los tipos que son ESTADO y no historia: se escriben con `upsertGrouped` y llevan
 * `groupKey`. Todos los demás son eventos inmutables y van por `createNotification`.
 *
 * Enumerarlos hace que la separación sea del compilador y no de la costumbre:
 * `upsertGrouped` sólo acepta éstos, y `createNotification` sólo los otros.
 */
type TipoAgrupado = 'MESSAGE_UNREAD';

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
  async createNotification<T extends Exclude<NotificationType, TipoAgrupado>>(
    userId: string,
    type: T,
    data: DataByType[T],
  ): Promise<void> {
    await this.prisma.notification.create({
      data: { userId, type, data: data as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * NOTIFICACIONES N4b — LA NOTIFICACIÓN VIVA: una por `(usuario, tipo, grupo)`.
   *
   * ── QUÉ HACE DISTINTO ──────────────────────────────────────────────────────
   *
   * `createNotification` añade una fila por evento y no la vuelve a tocar. Esto
   * mantiene UNA fila por grupo y la actualiza mientras el estado dure: es lo que
   * permite «3 mensajes de Juan» en vez de tres avisos.
   *
   * ── POR QUÉ EL `upsert` ES ATÓMICO Y NO UN «busca y si existe actualiza» ────
   *
   * Porque dos mensajes casi simultáneos en el mismo hilo entrarían a la vez y
   * crearían dos filas. El `@@unique([userId, type, groupKey])` lo hace imposible:
   * el `upsert` de Prisma se apoya en ese índice y la base resuelve la carrera.
   *
   * ── REVIVIR ES PARTE DEL CONTRATO ──────────────────────────────────────────
   *
   * El `update` pone `read: false` y `readAt: null` A PROPÓSITO. Si el usuario ya
   * había leído el hilo y llega un mensaje nuevo, la fila **vuelve a estar viva**;
   * sin esto, el aviso se actualizaría en silencio y no aparecería como pendiente.
   *
   * `createdAt` se refresca por lo mismo: la campana ordena por fecha y este aviso
   * significa «último mensaje», no «primer mensaje».
   */
  async upsertGrouped<T extends TipoAgrupado>(
    userId: string,
    type: T,
    groupKey: string,
    data: DataByType[T],
  ): Promise<void> {
    const payload = data as unknown as Prisma.InputJsonValue;
    await this.prisma.notification.upsert({
      where: { userId_type_groupKey: { userId, type, groupKey } },
      create: { userId, type, groupKey, data: payload },
      update: { data: payload, read: false, readAt: null, createdAt: new Date() },
    });
  }

  /**
   * Resuelve la notificación viva de un grupo: el estado que contaba ya no existe.
   *
   * `updateMany` y no `update`: si no hay ninguna (el usuario abre un hilo que
   * nunca le avisó) no es un error, son cero filas. Idempotente por construcción,
   * igual que `markRead`.
   */
  async resolveGrouped(userId: string, type: TipoAgrupado, groupKey: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, type, groupKey, read: false },
      data: { read: true, readAt: new Date() },
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
