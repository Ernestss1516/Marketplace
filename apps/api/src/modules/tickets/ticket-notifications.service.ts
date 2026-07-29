import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Ticket, TicketMessage } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QUEUE_NOTIFICATIONS } from '../../infra/queue/queue.constants';
import { NOTIFICATION_JOB } from '../../infra/queue/notification.types';
import { TICKET_EXCERPT_MAX_CHARS, TICKET_REOPEN_WINDOW_DAYS } from './tickets.constants';

/** Clave `Setting` con el buzón de soporte al que llegan los avisos de tickets. */
const SUPPORT_EMAIL_SETTING_KEY = 'supportEmail';

/**
 * Atención al usuario R4 — los AVISOS de un ticket.
 *
 * Servicio propio y no más métodos en TicketsService: aquí vive el "a quién se
 * le cuenta qué", que es una preocupación distinta de "qué transición es válida"
 * (mismo reparto que `ListingActivationService`, que agrupa los efectos
 * colaterales de que un anuncio pase a ACTIVE).
 *
 * DOS INVARIANTES QUE ESTE SERVICIO NO PUEDE ROMPER:
 *
 * 1. **El aviso es efecto, nunca causa.** Ningún método de aquí escribe en
 *    `Ticket.status` ni en ningún campo del hilo. La fuente de verdad es la
 *    acción HTTP; esto solo cuenta lo que ya pasó. Se invoca DESPUÉS del commit
 *    de la `$transaction` — si la transacción falla, no se avisa de nada.
 *
 * 2. **Ni la notificación ni el email transportan la conversación** (§11): solo
 *    `extracto` (≤140 caracteres) y el enlace. Es lo que hace verdad que la
 *    conversación in-app sea el canal y el correo el aviso.
 *
 * Y una defensa preparada: un mensaje `internal` NO dispara ningún aviso. Las
 * notas internas están aplazadas (§14.3) y hoy nada las crea, pero el guard está
 * puesto desde ya — igual que el filtro de `getForUser` en R1.
 */
@Injectable()
export class TicketNotificationsService {
  private readonly logger = new Logger(TicketNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly queue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // Avisos al STAFF
  // ---------------------------------------------------------------------------

  /**
   * Ticket nuevo de un usuario (flujo a) o respuesta suya en un hilo abierto.
   *
   * **Fan-out in-app, email único.** La `Notification` va a cada agente porque
   * `Notification` es estrictamente `userId` 1:1 y no existe un buzón de rol (ver
   * RC.1); el email va a UNA dirección de soporte (§14.4), no uno por
   * administrador como hace `ContactService`. Con el volumen que se espera de
   * tickets, multiplicar cada aviso por el número de admins es ruido que no
   * escala — y la campana ya cubre el "a cada uno le consta".
   */
  async staffNewActivity(ticket: Ticket, message: TicketMessage, kind: 'new' | 'reply'): Promise<void> {
    if (message.internal) return;

    const [ticketFull, staff] = await Promise.all([
      this.prisma.ticket.findUnique({
        where: { id: ticket.id },
        select: { user: { select: { name: true } }, topic: { select: { nombre: true } } },
      }),
      this.prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'MODERATOR'] } },
        select: { id: true },
      }),
    ]);
    if (!ticketFull) return;

    // NOMBRES ya resueltos en el snapshot, nunca ids: la notificación debe
    // pintarse sin consultas y sobrevivir a que el motivo se renombre (RC.2).
    const data = {
      ticketId: ticket.id,
      subject: ticket.subject,
      extracto: this.excerpt(message.body),
      userName: ticketFull.user.name,
      topic: ticketFull.topic?.nombre ?? null,
    };

    await Promise.all(
      staff.map((s) => this.notifications.createNotification(s.id, 'TICKET_STAFF_NEW', data)),
    );

    const to = await this.getSupportEmail();
    if (!to) return; // ya se ha avisado por log; ver getSupportEmail
    await this.queue.add(NOTIFICATION_JOB.SEND_TICKET_STAFF_NOTIFICATION, {
      to,
      ticketId: ticket.id,
      subject: ticket.subject,
      extracto: data.extracto,
      userName: data.userName,
      kind,
    });
  }

  // ---------------------------------------------------------------------------
  // Avisos al USUARIO
  // ---------------------------------------------------------------------------

  /**
   * El staff ha escrito en el hilo. `opened` distingue la apertura de un hilo por
   * parte de la administración (flujos b/c → `TICKET_OPENED`) de una respuesta en
   * un hilo ya existente (T3/T4 → `TICKET_MESSAGE`).
   */
  async userStaffWrote(ticket: Ticket, message: TicketMessage, opened: boolean): Promise<void> {
    if (message.internal) return;

    const extracto = this.excerpt(message.body);

    if (opened) {
      await this.notifications.createNotification(ticket.userId, 'TICKET_OPENED', {
        ticketId: ticket.id,
        subject: ticket.subject,
        extracto,
      });
    } else {
      await this.notifications.createNotification(ticket.userId, 'TICKET_MESSAGE', {
        ticketId: ticket.id,
        subject: ticket.subject,
        extracto,
        // Congelado: el estado EN EL INSTANTE del aviso, no el que tenga el
        // ticket cuando el usuario abra la campana tres días después.
        status: ticket.status,
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: ticket.userId },
      select: { email: true, name: true },
    });
    if (!user) return;

    await this.queue.add(NOTIFICATION_JOB.SEND_TICKET_MESSAGE, {
      email: user.email,
      name: user.name,
      ticketId: ticket.id,
      subject: ticket.subject,
      extracto,
      opened,
    });
  }

  /** T7 — el ticket se ha resuelto. Se avisa con la ventana de reapertura. */
  async userResolved(ticket: Ticket): Promise<void> {
    await this.notifications.createNotification(ticket.userId, 'TICKET_MESSAGE', {
      ticketId: ticket.id,
      subject: ticket.subject,
      extracto: `Tu ticket se ha marcado como resuelto. Puedes reabrirlo respondiendo durante ${TICKET_REOPEN_WINDOW_DAYS} días.`,
      status: ticket.status,
    });

    const user = await this.prisma.user.findUnique({
      where: { id: ticket.userId },
      select: { email: true, name: true },
    });
    if (!user) return;

    await this.queue.add(NOTIFICATION_JOB.SEND_TICKET_RESOLVED, {
      email: user.email,
      name: user.name,
      ticketId: ticket.id,
      subject: ticket.subject,
      reopenWindowDays: TICKET_REOPEN_WINDOW_DAYS,
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Buzón de soporte, desde `Setting` (molde `fiscalIssuer` /
   * `fiscalSelfServiceWindow`: configurable en caliente, sin despliegue).
   *
   * SIN CONFIGURAR → se registra un warning y NO se manda el correo. Se descartó
   * caer en fan-out a los administradores: ese es justo el comportamiento que
   * §14.4 quiso evitar, y reintroducirlo por la puerta de atrás en el estado de
   * "mal configurado" es la peor forma de tenerlo. **No se pierde ningún aviso**
   * — la `Notification` in-app a cada agente se crea siempre, y es esa la que
   * garantiza que al staff le consta. El correo es el auxiliar del auxiliar.
   */
  private async getSupportEmail(): Promise<string | null> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SUPPORT_EMAIL_SETTING_KEY },
    });
    const value = typeof setting?.value === 'string' ? setting.value.trim() : '';
    if (!value) {
      this.logger.warn(
        `Setting '${SUPPORT_EMAIL_SETTING_KEY}' sin configurar: no se envía el email de aviso al ` +
          'soporte. Los avisos in-app al staff SÍ se han creado. Configúralo en el backoffice.',
      );
      return null;
    }
    return value;
  }

  /** Extracto de ≤140 caracteres — molde exacto de `ContactService.notifyAdmins`. */
  private excerpt(body: string): string {
    return body.length > TICKET_EXCERPT_MAX_CHARS
      ? `${body.slice(0, TICKET_EXCERPT_MAX_CHARS)}…`
      : body;
  }
}
