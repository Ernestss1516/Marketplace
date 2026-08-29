import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QUEUE_MESSAGE_DIGEST } from '../../infra/queue/queue.constants';
import { MessagingGateway } from './messaging.gateway';

/** Clave `Setting` de la ventana de gracia, en minutos. */
export const MESSAGE_EMAIL_GRACE_SETTING = 'messageEmailGraceMinutes';

/**
 * Diez minutos. Cubre la ráfaga típica de mensajes seguidos sin llegar a parecer un
 * resumen tardío. Configurable a propósito (§4.4 del diseño): el valor correcto
 * depende del ritmo real de las conversaciones, que todavía no se conoce.
 */
export const DEFAULT_GRACE_MINUTES = 10;

/** Nombre del trabajo diferido. Uno solo en esta cola. */
export const MESSAGE_DIGEST_JOB = 'message-digest';

export interface MessageDigestJobData {
  conversationId: string;
  recipientId: string;
}

/** Extracto de ≤140 caracteres — molde exacto de tickets y contacto. */
const EXTRACTO_MAX = 140;

/**
 * NOTIFICACIONES N4b — LOS AVISOS DE LA MENSAJERÍA.
 *
 * Implementa las tres decisiones de `docs/diseno-notificaciones-mensajeria.md`:
 *
 *  1. **Por CONVERSACIÓN, con contador.** Una notificación VIVA por hilo que se
 *     actualiza (`upsertGrouped`), nunca una por mensaje: eso convertiría la
 *     campana en un chat roto.
 *  2. **Sólo si NO lo está viendo.** Si tiene ese hilo activo, el WebSocket ya se
 *     lo entregó y no se hace nada — ni notificación ni correo.
 *  3. **El correo, con ventana de gracia.** Diferido N minutos y AUTOCANCELANTE.
 *
 * ── EL AVISO ES EFECTO, NUNCA CAUSA ────────────────────────────────────────
 *
 * Nada de aquí escribe en `Message` ni en `Conversation`. Se invoca DESPUÉS de que
 * el mensaje haya persistido y de que el gateway lo haya emitido.
 */
@Injectable()
export class MessageNotificationsService {
  private readonly logger = new Logger(MessageNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly gateway: MessagingGateway,
    @InjectQueue(QUEUE_MESSAGE_DIGEST) private readonly digestQueue: Queue,
  ) {}

  /**
   * Un mensaje nuevo. Decide si hay que avisar y, si toca, arma los dos canales.
   *
   * `senderId` sirve para saber quién es el OTRO: el aviso es siempre para quien no
   * escribió.
   */
  async mensajeEnviado(
    conversationId: string,
    senderId: string,
    body: string,
    participantes: { buyerId: string; sellerId: string },
  ): Promise<void> {
    const recipientId =
      participantes.buyerId === senderId ? participantes.sellerId : participantes.buyerId;

    /**
     * DECISIÓN 2 — SI LO ESTÁ VIENDO, SILENCIO TOTAL.
     *
     * Y se pregunta por el HILO ACTIVO, no por la sala: la sala sólo crece (ver
     * `estaViendoConversacion`), así que usarla silenciaría los hilos que tiene
     * abiertos pero no está mirando. Ése es el fallo que esta comprobación existe
     * para no cometer.
     */
    if (await this.gateway.estaViendoConversacion(recipientId, conversationId)) return;

    await this.avisarEnLaCampana(conversationId, recipientId, senderId, body);
    await this.armarVentanaDeGracia(conversationId, recipientId);
  }

  /**
   * DECISIÓN 1 — la notificación VIVA. Una por hilo, con el contador al día.
   *
   * El contador se RECALCULA con el mismo `COUNT` que usa la bandeja
   * (`senderId != yo`, `readAt: null`), nunca se incrementa: un `increment`
   * acumularía deriva en cuanto `getConversation` marcara leído por su cuenta.
   */
  private async avisarEnLaCampana(
    conversationId: string,
    recipientId: string,
    senderId: string,
    body: string,
  ): Promise<void> {
    const [conv, sinLeer, remitente] = await Promise.all([
      this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { listingTitle: true },
      }),
      this.prisma.message.count({
        where: { conversationId, senderId: { not: recipientId }, readAt: null },
      }),
      this.prisma.user.findUnique({
        where: { id: senderId },
        select: { name: true, slug: true },
      }),
    ]);
    if (!conv || !remitente) return;

    await this.notifications.upsertGrouped(recipientId, 'MESSAGE_UNREAD', conversationId, {
      conversationId,
      // Nombre YA RESUELTO. Si esa cuenta se vacía después, `deleteAccount` deja su
      // `name` en «Usuario eliminado»; aquí queda congelado lo que fuera verdad al
      // avisar, que es lo correcto.
      otherUserName: remitente.name,
      otherUserSlug: remitente.slug,
      listingTitle: conv.listingTitle,
      unreadCount: sinLeer,
      extracto: this.extracto(body),
    });
  }

  /**
   * DECISIÓN 3 — LA VENTANA DE GRACIA.
   *
   * ── EL `jobId` ES LO QUE IMPIDE UN CORREO POR MENSAJE ──────────────────────
   *
   * BullMQ rechaza un trabajo cuyo id ya existe, así que el segundo, tercero y
   * décimo mensaje de la ventana **no encolan nada**: el primero ya dejó el
   * temporizador puesto, y cuando salte contará todos los acumulados. Es el mismo
   * mecanismo de deduplicación que `expireFeaturedListings` usa con su `jobId`.
   *
   * NO SE CANCELA NADA CUANDO EL USUARIO LEE, y es deliberado: borrar el trabajo
   * obligaría a acordarse de hacerlo en cada camino que marque leído, y olvidar uno
   * manda un correo mentiroso. El trabajo **comprueba al dispararse**
   * (`MessageDigestProcessor`), que es autocancelante y no tiene carreras.
   */
  private async armarVentanaDeGracia(
    conversationId: string,
    recipientId: string,
  ): Promise<void> {
    const minutos = await this.leerVentanaDeGracia();

    await this.digestQueue.add(
      MESSAGE_DIGEST_JOB,
      { conversationId, recipientId } satisfies MessageDigestJobData,
      {
        delay: minutos * 60_000,
        jobId: `msg-mail:${recipientId}:${conversationId}`,
      },
    );
  }

  /**
   * La ventana, desde `Setting`. Molde `ticketAutoCloseWindowDays` y
   * `defaultSuspensionDays`: configurable en caliente, con el defecto en código.
   */
  private async leerVentanaDeGracia(): Promise<number> {
    const ajuste = await this.prisma.setting.findUnique({
      where: { key: MESSAGE_EMAIL_GRACE_SETTING },
    });
    const minutos = Number(ajuste?.value);
    return Number.isFinite(minutos) && minutos > 0 ? minutos : DEFAULT_GRACE_MINUTES;
  }

  /**
   * El destinatario ha abierto el hilo: el estado que la notificación contaba ya no
   * existe.
   *
   * NO se toca el trabajo diferido. Cuando salte verá que no hay mensajes sin leer
   * y no mandará nada — ver `armarVentanaDeGracia`.
   */
  async hiloLeido(conversationId: string, userId: string): Promise<void> {
    await this.notifications.resolveGrouped(userId, 'MESSAGE_UNREAD', conversationId);
  }

  private extracto(body: string): string {
    return body.length > EXTRACTO_MAX ? `${body.slice(0, EXTRACTO_MAX)}…` : body;
  }
}
