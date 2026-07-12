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
}
