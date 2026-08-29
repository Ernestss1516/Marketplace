import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_MESSAGE_DIGEST, QUEUE_NOTIFICATIONS } from '../../infra/queue/queue.constants';
import {
  NOTIFICATION_JOB,
  type SendMessageUnreadData,
} from '../../infra/queue/notification.types';
import type { MessageDigestJobData } from './message-notifications.service';

/**
 * NOTIFICACIONES N4b — EL FINAL DE LA VENTANA DE GRACIA.
 *
 * ── LO QUE ESTE TRABAJO HACE, Y ES TODO ────────────────────────────────────
 *
 * Se despierta N minutos después del primer mensaje sin ver y hace UNA pregunta:
 *
 *   > ¿Sigue habiendo mensajes sin leer de esta conversación para esta persona?
 *
 * **No → no manda nada, y ése es el caso bueno**: significa que entró y los leyó
 * dentro de la ventana. **Sí → un correo con el total acumulado.**
 *
 * ── POR QUÉ COMPROBAR AQUÍ Y NO CANCELAR AL LEER ───────────────────────────
 *
 * Cancelar obligaría a borrar el trabajo desde cada camino que marque leído, y
 * olvidar uno manda un correo que dice «tienes 3 mensajes» a quien acaba de
 * leerlos. Comprobar al disparar es **autocancelante**: se apoya en `readAt`, que
 * `getConversation` ya escribe al abrir el hilo, así que no hay que tocar el camino
 * de lectura ni hay carrera posible entre borrar y disparar.
 *
 * ── POR QUÉ NO MANDA EL CORREO ÉL MISMO ────────────────────────────────────
 *
 * Porque este trabajo DECIDE y `QUEUE_NOTIFICATIONS` MANDA. Su procesador sólo
 * conoce Resend y no toca la base; meterle Prisma para esto rompería lo único que
 * lo hace fácil de razonar. Dos saltos, cada capa con su trabajo.
 */
@Processor(QUEUE_MESSAGE_DIGEST)
export class MessageDigestProcessor extends WorkerHost {
  private readonly logger = new Logger(MessageDigestProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly notificationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<MessageDigestJobData>): Promise<void> {
    const { conversationId, recipientId } = job.data;

    try {
      // LA COMPROBACIÓN. El mismo predicado que usa la bandeja para su contador:
      // mensajes de la OTRA parte que siguen sin `readAt`.
      const sinLeer = await this.prisma.message.count({
        where: { conversationId, senderId: { not: recipientId }, readAt: null },
      });

      if (sinLeer === 0) {
        // EL CASO BUENO: entró y los leyó dentro de la ventana. No es un fallo y no
        // se registra como tal.
        this.logger.debug(
          `Ventana cumplida sin correo: ${recipientId} ya leyó ${conversationId}`,
        );
        return;
      }

      // El ÚLTIMO mensaje entrante da el extracto; el interlocutor, el nombre.
      const [ultimo, destinatario] = await Promise.all([
        this.prisma.message.findFirst({
          where: { conversationId, senderId: { not: recipientId } },
          orderBy: { createdAt: 'desc' },
          select: { body: true, sender: { select: { name: true } } },
        }),
        this.prisma.user.findUnique({
          where: { id: recipientId },
          select: { email: true, name: true },
        }),
      ]);
      if (!ultimo || !destinatario) return;

      await this.notificationQueue.add(NOTIFICATION_JOB.SEND_MESSAGE_UNREAD, {
        email: destinatario.email,
        name: destinatario.name,
        conversationId,
        otherUserName: ultimo.sender.name,
        // AGRUPADO: el total de la ventana en UN correo, no uno por mensaje.
        unreadCount: sinLeer,
        extracto: ultimo.body.length > 140 ? `${ultimo.body.slice(0, 140)}…` : ultimo.body,
      } satisfies SendMessageUnreadData);

      this.logger.log(
        `Correo de ${sinLeer} mensaje(s) sin leer encolado para ${recipientId} (${conversationId})`,
      );
    } catch (err) {
      Sentry.captureException(err);
      throw err;
    }
  }
}
