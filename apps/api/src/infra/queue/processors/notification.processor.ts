import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Resend } from 'resend';
import { QUEUE_NOTIFICATIONS } from '../queue.constants';
import {
  NOTIFICATION_JOB,
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
    switch (job.name) {
      case NOTIFICATION_JOB.SEND_VERIFICATION_EMAIL:
        return this.sendVerificationEmail(job.data as SendVerificationEmailData);
      case NOTIFICATION_JOB.SEND_RESET_EMAIL:
        return this.sendResetEmail(job.data as SendResetEmailData);
      default:
        this.logger.warn(`Unknown notification job: ${job.name}`);
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
}
