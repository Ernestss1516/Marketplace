import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Resend } from 'resend';
import { QUEUE_NOTIFICATIONS } from '../queue.constants';
import {
  NOTIFICATION_JOB,
  SendAlertEmailData,
  SendContactNotificationData,
  SendContactReplyData,
  SendResetEmailData,
  SendReviewRequestEmailData,
  SendAccountModeratedData,
  SendBumpAutoPausedData,
  SendListingModeratedData,
  SendTicketMessageData,
  SendTicketResolvedData,
  SendTicketStaffNotificationData,
  SendVerificationEmailData,
} from '../notification.types';

@Processor(QUEUE_NOTIFICATIONS)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);
  private readonly resend: Resend;
  private readonly from: string;
  private readonly appUrl: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.resend = new Resend(config.getOrThrow<string>('resend.apiKey'));
    this.from = config.getOrThrow<string>('resend.from');
    this.appUrl = config.get<string>('appUrl', 'http://localhost:3000');
  }

  async process(job: Job): Promise<void> {
    try {
      switch (job.name) {
        case NOTIFICATION_JOB.SEND_VERIFICATION_EMAIL:
          return this.sendVerificationEmail(job.data as SendVerificationEmailData);
        case NOTIFICATION_JOB.SEND_RESET_EMAIL:
          return this.sendResetEmail(job.data as SendResetEmailData);
        case NOTIFICATION_JOB.SEND_ALERT_EMAIL:
          return this.sendAlertEmail(job.data as SendAlertEmailData);
        case NOTIFICATION_JOB.SEND_CONTACT_NOTIFICATION:
          return this.sendContactNotification(job.data as SendContactNotificationData);
        case NOTIFICATION_JOB.SEND_CONTACT_REPLY:
          return this.sendContactReply(job.data as SendContactReplyData);
        case NOTIFICATION_JOB.SEND_REVIEW_REQUEST_EMAIL:
          return this.sendReviewRequestEmail(job.data as SendReviewRequestEmailData);
        case NOTIFICATION_JOB.SEND_TICKET_MESSAGE:
          return this.sendTicketMessage(job.data as SendTicketMessageData);
        case NOTIFICATION_JOB.SEND_TICKET_STAFF_NOTIFICATION:
          return this.sendTicketStaffNotification(job.data as SendTicketStaffNotificationData);
        case NOTIFICATION_JOB.SEND_TICKET_RESOLVED:
          return this.sendTicketResolved(job.data as SendTicketResolvedData);
        case NOTIFICATION_JOB.SEND_LISTING_MODERATED:
          return this.sendListingModerated(job.data as SendListingModeratedData);
        case NOTIFICATION_JOB.SEND_BUMP_AUTO_PAUSED:
          return this.sendBumpAutoPaused(job.data as SendBumpAutoPausedData);
        case NOTIFICATION_JOB.SEND_ACCOUNT_MODERATED:
          return this.sendAccountModerated(job.data as SendAccountModeratedData);
        default:
          this.logger.warn(`Unknown notification job: ${job.name}`);
      }
    } catch (err) {
      Sentry.captureException(err);
      throw err;
    }
  }

  private async sendVerificationEmail(data: SendVerificationEmailData): Promise<void> {
    const link = `${this.appUrl}/verificar-email?token=${data.token}`;
    await this.resend.emails.send({
      from: this.from,
      to: data.email,
      subject: 'Confirma tu email',
      text: `Hola ${data.name},\n\nConfirma tu cuenta haciendo clic en este enlace (válido 24h):\n${link}\n\nSi no has creado una cuenta, ignora este email.`,
    });
    this.logger.log(`Verification email sent to ${data.email}`);
  }

  private async sendResetEmail(data: SendResetEmailData): Promise<void> {
    const link = `${this.appUrl}/restablecer?token=${data.token}`;
    await this.resend.emails.send({
      from: this.from,
      to: data.email,
      subject: 'Restablece tu contraseña',
      text: `Hola ${data.name},\n\nRestablece tu contraseña haciendo clic en este enlace (válido 1h):\n${link}\n\nSi no solicitaste esto, ignora este email.`,
    });
    this.logger.log(`Reset email sent to ${data.email}`);
  }

  private async sendAlertEmail(data: SendAlertEmailData): Promise<void> {
    const link = `${this.appUrl}/anuncio/${data.listingSlug}`;
    await this.resend.emails.send({
      from: this.from,
      to: data.email,
      subject: `Nuevo anuncio para tu alerta "${data.alertName}"`,
      text: `Hola ${data.name},\n\nHay un nuevo anuncio que coincide con tu alerta "${data.alertName}":\n${data.listingTitle}\n\nVerlo aquí:\n${link}`,
    });
    this.logger.log(`Alert email sent to ${data.email}`);
  }

  /** text: plano SIEMPRE (RC.1, defensa XSS) — el mensaje lo escribe un
   * desconocido y lo lee el admin; nunca se genera HTML a partir de su contenido. */
  private async sendContactNotification(data: SendContactNotificationData): Promise<void> {
    const link = `${this.appUrl}/admin/mensajes-contacto/${data.messageId}`;
    await this.resend.emails.send({
      from: this.from,
      to: data.adminEmail,
      subject: `Nuevo mensaje de contacto (${data.motivo})`,
      text: `Hola ${data.adminName},\n\nHa llegado un nuevo mensaje de contacto de ${data.remitenteEmail}:\n\n"${data.extracto}"\n\nVerlo y responder aquí:\n${link}`,
    });
    this.logger.log(`Contact notification email sent to ${data.adminEmail}`);
  }

  /** text: plano — asunto/cuerpo los escribe el admin (autor de confianza),
   * pero se mantiene el mismo patrón que el resto de la cola por consistencia. */
  private async sendContactReply(data: SendContactReplyData): Promise<void> {
    await this.resend.emails.send({
      from: this.from,
      to: data.to,
      subject: data.asunto,
      text: data.cuerpo,
    });
    this.logger.log(`Contact reply email sent to ${data.to}`);
  }

  // ─── Atención al usuario R4 ─────────────────────────────────────────────────
  // `text:` plano, nunca `html:` — la regla invariante de este processor. Aquí
  // importa especialmente: el asunto y el extracto de un ticket los escribe un
  // usuario cualquiera, y los lee un agente con sesión. Nunca se genera HTML a
  // partir de contenido no confiable, así que no hace falta sanitizado.

  /** Cierre común: el email avisa, no es el canal. Ver §11 del diseño. */
  private readonly noReply =
    'No respondas a este correo: responde desde tu ticket en el enlace de arriba.';

  /**
   * Al usuario — el staff respondió (o abrió el hilo). Lleva EXTRACTO + ENLACE,
   * jamás la conversación: quien quiera leerla entra. Molde exacto de
   * SEND_CONTACT_NOTIFICATION, que ya hacía esto.
   */
  private async sendTicketMessage(data: SendTicketMessageData): Promise<void> {
    const link = `${this.appUrl}/mis-tickets/${data.ticketId}`;
    const encabezado = data.opened
      ? 'La administración ha abierto un hilo contigo'
      : 'Tienes una respuesta nueva en tu ticket';
    await this.resend.emails.send({
      from: this.from,
      to: data.email,
      subject: `${encabezado}: ${data.subject}`,
      text:
        `Hola ${data.name},\n\n${encabezado} «${data.subject}»:\n\n"${data.extracto}"\n\n` +
        `Léelo y responde aquí:\n${link}\n\n${this.noReply}`,
    });
    this.logger.log(`Ticket message email sent to ${data.email}`);
  }

  /**
   * Al buzón de soporte — UNO SOLO, no un email por administrador (§14.4). El
   * aviso in-app sí es fan-out; el correo no, porque no escala con el volumen de
   * tickets que se espera.
   */
  private async sendTicketStaffNotification(data: SendTicketStaffNotificationData): Promise<void> {
    const link = `${this.appUrl}/admin/tickets/${data.ticketId}`;
    const encabezado = data.kind === 'new' ? 'Nuevo ticket' : 'Respuesta del usuario';
    await this.resend.emails.send({
      from: this.from,
      to: data.to,
      subject: `${encabezado}: ${data.subject}`,
      text:
        `${encabezado} de ${data.userName} — «${data.subject}»:\n\n"${data.extracto}"\n\n` +
        `Atenderlo aquí:\n${link}`,
    });
    this.logger.log(`Ticket staff notification email sent to ${data.to}`);
  }

  /** Al usuario — su ticket se ha resuelto. Explica la ventana de reapertura. */
  /**
   * Bump automático parado. Va por email además de in-app (D6) porque el usuario puede tardar
   * días en abrir la web y, mientras tanto, su anuncio no se está subiendo — que es
   * justamente lo que había contratado.
   */
  private async sendBumpAutoPaused(data: SendBumpAutoPausedData): Promise<void> {
    const link = `${this.appUrl}/mis-anuncios`;
    const [motivo, salida] =
      data.reason === 'NO_FUNDS'
        ? [
            'te has quedado sin saldo para seguir subiéndolo',
            `Recarga créditos o bumps y vuelve a activarla cuando quieras:\n${this.appUrl}/mis-creditos`,
          ]
        : [
            'el anuncio ya no está activo',
            `Si vuelves a activarlo, la programación se reanuda sola:\n${link}`,
          ];

    await this.resend.emails.send({
      from: this.from,
      to: data.email,
      subject: `Hemos pausado los bumps programados de «${data.listingTitle}»`,
      text:
        `Hola ${data.name},\n\nHemos pausado la subida automática de «${data.listingTitle}» porque ${motivo}.\n\n` +
        `No se te ha cobrado nada por este intento.\n\n${salida}\n\n${this.noReply}`,
    });
    this.logger.log(`Bump auto paused email sent to ${data.email} (${data.reason})`);
  }

  private async sendTicketResolved(data: SendTicketResolvedData): Promise<void> {
    const link = `${this.appUrl}/mis-tickets/${data.ticketId}`;
    await this.resend.emails.send({
      from: this.from,
      to: data.email,
      subject: `Tu ticket se ha resuelto: ${data.subject}`,
      text:
        `Hola ${data.name},\n\nHemos marcado como resuelto tu ticket «${data.subject}».\n\n` +
        `Si el problema sigue, tienes ${data.reopenWindowDays} días para reabrirlo respondiendo ` +
        `en el hilo:\n${link}\n\nPasado ese plazo tendrás que abrir uno nuevo.\n\n${this.noReply}`,
    });
    this.logger.log(`Ticket resolved email sent to ${data.email}`);
  }

  /**
   * Moderación (§14.5) — al vendedor. `text:` plano como todos: el `reason` lo
   * escribe un moderador, pero se mantiene la regla invariante del processor.
   *
   * Copy sin acusación: la moderación puede equivocarse (de hecho `restoreListing`
   * existe justo para deshacerla), así que el correo dice QUÉ ha pasado y CÓMO
   * seguir, no sentencia sobre la conducta del vendedor.
   */
  private async sendListingModerated(data: SendListingModeratedData): Promise<void> {
    const link = `${this.appUrl}/mis-anuncios`;
    const motivo = data.reason ? `\n\nMotivo indicado: ${data.reason}` : '';

    // A1 — `Record<…>` EXPLÍCITO, no un objeto suelto: si a `action` se le añade un
    // valor y aquí no se le da su copy, esto deja de compilar. Es la misma barrera
    // que se puso en el front, donde el mapa gemelo se quedó sin la rama `APPROVED`
    // y el aviso in-app salía vacío mientras este correo sí se mandaba bien.
    const copy: Record<
      SendListingModeratedData['action'],
      { subject: string; cuerpo: string }
    > = {
      // MODERACIÓN M2 — el aviso que faltaba. Hasta aquí, un anuncio aprobado se
      // publicaba sin que a su dueño le llegara nada: con la moderación previa
      // encendida, pasar por revisión deja de ser la excepción y el silencio se
      // convierte en «mi anuncio lleva días sin aparecer… ¿o ya está?».
      APPROVED: {
        subject: `Tu anuncio "${data.listingTitle}" ya está publicado`,
        cuerpo:
          `Hemos revisado tu anuncio «${data.listingTitle}» y ya está publicado en el ` +
          `marketplace.\n\nPuedes verlo aquí:\n${link}`,
      },
      REJECTED: {
        subject: `Tu anuncio "${data.listingTitle}" no ha pasado la revisión`,
        cuerpo:
          `Hemos revisado tu anuncio «${data.listingTitle}» y de momento no podemos publicarlo.${motivo}\n\n` +
          `Puedes editarlo y volver a enviarlo desde aquí:\n${link}`,
      },
      DEACTIVATED: {
        subject: `Hemos retirado tu anuncio "${data.listingTitle}"`,
        cuerpo:
          `Hemos retirado del marketplace tu anuncio «${data.listingTitle}».${motivo}\n\n` +
          `Puedes revisarlo desde aquí:\n${link}\n\nSi crees que es un error, escríbenos y lo miramos.`,
      },
      RESTORED: {
        subject: `Tu anuncio "${data.listingTitle}" vuelve a estar publicado`,
        cuerpo:
          `Buenas noticias: hemos revisado tu anuncio «${data.listingTitle}» y vuelve a estar ` +
          `publicado en el marketplace.\n\nPuedes verlo aquí:\n${link}`,
      },
    };
    const { subject, cuerpo } = copy[data.action];

    await this.resend.emails.send({
      from: this.from,
      to: data.email,
      subject,
      text: `Hola ${data.name},\n\n${cuerpo}`,
    });
    this.logger.log(`Listing moderated email (${data.action}) sent to ${data.email}`);
  }

  /**
   * NOTIFICACIONES N2 — LA DECISIÓN SOBRE LA CUENTA. **El único canal que le llega.**
   *
   * Un `SUSPENDED`, un `BANNED` y un `ARCHIVED` no pueden entrar, así que no hay
   * campana que puedan abrir: si este correo no sale, se enteran chocando contra el
   * login. De ahí que en N2 no sea opcional.
   *
   * ── EL REGISTRO DEL COPY ────────────────────────────────────────────────────
   *
   * El mismo que `sendListingModerated` dejó fijado y por la misma razón: **dice QUÉ
   * ha pasado y CÓMO seguir, no sentencia sobre la conducta**. La moderación puede
   * equivocarse —`unsuspend` y `reinstate` existen justo para deshacerla—, y un
   * correo que acusa convierte un error reversible en una afrenta. Todos ofrecen la
   * salida real: soporte.
   *
   * `motivo` es el VISIBLE. La nota interna no llega hasta aquí:
   * `SendAccountModeratedData` no tiene campo para ella.
   *
   * `text:` plano como todo el processor, y aquí importa especialmente: `reason` lo
   * escribe un moderador y lo lee el sancionado.
   */
  private async sendAccountModerated(data: SendAccountModeratedData): Promise<void> {
    const soporte = `Si crees que es un error, escríbenos desde ${this.appUrl}/contacto y lo revisamos.`;
    const motivo = data.reason ? `\n\nMotivo: ${data.reason}` : '';

    // Record EXHAUSTIVO (la red de A1): una acción sin copy no compila.
    const copy: Record<SendAccountModeratedData['action'], { subject: string; cuerpo: string }> = {
      SUSPENDED: {
        subject: 'Hemos suspendido temporalmente tu cuenta',
        cuerpo:
          `Hemos suspendido tu cuenta de forma temporal, así que de momento no podrás entrar.${motivo}\n\n` +
          (data.suspendedUntil
            ? `La suspensión termina el ${this.fecha(data.suspendedUntil)} y tu cuenta se reactiva sola: no tienes que hacer nada.`
            : 'La suspensión no tiene fecha de fin por ahora.') +
          `\n\n${soporte}`,
      },
      UNSUSPENDED: {
        subject: 'Tu cuenta vuelve a estar activa',
        cuerpo:
          'Hemos levantado la suspensión de tu cuenta: ya puedes entrar y usarla con normalidad.\n\n' +
          'Tus anuncios siguen como estaban.',
      },
      BANNED: {
        subject: 'Hemos inhabilitado tu cuenta',
        cuerpo:
          `Hemos inhabilitado tu cuenta de forma permanente y ya no podrás entrar.${motivo}\n\n` +
          `Tus anuncios se han retirado del marketplace.\n\n${soporte}`,
      },
      /**
       * LA ASIMETRÍA DE `reinstateUser`, DICHA EN VOZ ALTA. Es la razón de que este
       * texto sea distinto del de `UNSUSPENDED`: levantar un ban devuelve el ACCESO,
       * pero **NO reactiva los anuncios** —los pausó la sanción y los reactiva su
       * dueño, uno a uno, porque «una sanción no se deshace sola»—. Sin decirlo,
       * quien vuelve encuentra su escaparate vacío y da por hecho que la plataforma
       * está rota o que sigue sancionado.
       */
      REINSTATED: {
        subject: 'Tu cuenta vuelve a estar activa',
        cuerpo:
          'Hemos revisado tu caso y tu cuenta vuelve a estar activa: ya puedes entrar.\n\n' +
          'IMPORTANTE: tus anuncios NO se reactivan solos. Se quedaron en pausa y los tienes ' +
          `esperándote en ${this.appUrl}/mis-anuncios — desde ahí puedes volver a activarlos ` +
          'cuando quieras.',
      },
      ARCHIVED: {
        subject: 'Hemos archivado tu cuenta',
        cuerpo:
          'Hemos archivado tu cuenta, así que ya no podrás entrar y tus anuncios han salido ' +
          `del marketplace.${motivo}\n\n${soporte}`,
      },
      ROLE_CHANGED: {
        subject: 'Hemos cambiado los permisos de tu cuenta',
        cuerpo:
          `Hemos cambiado el rol de tu cuenta${data.newRole ? ` a ${data.newRole}` : ''}.${motivo}\n\n` +
          // Se avisa del efecto porque, si no, el siguiente clic es un 401 sin
          // explicación: el cambio de rol invalida todas las sesiones a propósito.
          'Por seguridad hemos cerrado tus sesiones abiertas: vuelve a iniciar sesión en ' +
          `${this.appUrl}/login.`,
      },
      // Terminal, y el ÚNICO canal posible: eliminar la cuenta borra sus
      // notificaciones, así que un aviso in-app se destruiría a sí mismo.
      DELETED: {
        subject: 'Tu cuenta se ha eliminado definitivamente',
        cuerpo:
          'Hemos eliminado tu cuenta y los datos personales asociados. Esta acción no tiene ' +
          `vuelta atrás y no hace falta que hagas nada más.${motivo}`,
      },
    };
    const { subject, cuerpo } = copy[data.action];

    await this.resend.emails.send({
      from: this.from,
      to: data.email,
      subject,
      text: `Hola ${data.name},\n\n${cuerpo}`,
    });
    this.logger.log(`Account moderated email (${data.action}) sent to ${data.email}`);
  }

  /** Fecha legible para el copy. Molde del front: `es-ES`, día y mes. */
  private fecha(iso: string): string {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  /**
   * Reputación RÁFAGA 3 — copy deliberadamente sin presión ni plazo: valorar es
   * opcional, sin ventana de tiempo. Un job por parte (ver closeDeal en
   * ListingsService), igual que SEND_CONTACT_NOTIFICATION es un job por admin.
   *
   * NOTIFICACIONES A1 — EL ENLACE YA NO VA AL ANUNCIO. Iba a `/anuncio/{slug}` y
   * daba 404 en todos los tratos de producto, porque `closeDeal` deja el anuncio
   * en `SOLD` y la ficha pública sólo sirve los `ACTIVE`. Ahora va al MISMO sitio
   * que la notificación in-app —el deep-link de valoración en el perfil del otro,
   * que no depende del estado del anuncio—, así que además los dos canales dicen
   * lo mismo. Ver `SendReviewRequestEmailData`.
   */
  private async sendReviewRequestEmail(data: SendReviewRequestEmailData): Promise<void> {
    const link =
      `${this.appUrl}/vendedor/${data.otherUserSlug}` +
      `?valorar=${encodeURIComponent(data.listingId ?? '')}` +
      `&target=${encodeURIComponent(data.otherUserId)}`;
    await this.resend.emails.send({
      from: this.from,
      to: data.email,
      subject: `${data.otherUserName} cerró un trato contigo`,
      text: `Hola ${data.name},\n\n${data.otherUserName} cerró un trato contigo sobre "${data.listingTitle}". Si quieres, puedes dejar tu valoración:\n${link}\n\nEs totalmente opcional.`,
    });
    this.logger.log(`Review request email sent to ${data.email}`);
  }
}
