import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_NOTIFICATIONS } from '../../infra/queue/queue.constants';
import { NOTIFICATION_JOB, type SendBumpAutoPausedData } from '../../infra/queue/notification.types';
import { NotificationsService } from '../notifications/notifications.service';

interface PausaData {
  scheduleId: string;
  listingId: string;
  listingTitle: string;
}

/**
 * Los avisos del bump automático, en un sitio.
 *
 * D6 — SOLO SE AVISA DE INCIDENCIAS. Un bump aplicado no genera notificación: es exactamente
 * lo que el usuario configuró para no tener que enterarse, y con varias programaciones
 * activas un aviso por bump convertiría la campana en ruido. La trazabilidad no se
 * sacrifica, cambia de canal: cada turno queda en `BumpRun`, que es donde se pregunta
 * «¿por qué se me van los créditos?».
 *
 * Lo que sí se avisa es que la programación DEJÓ DE CORRER, y va por los DOS canales
 * (in-app + email) porque exige que el usuario haga algo y puede tardar días en entrar.
 * Molde de doble canal: `TicketNotificationsService`.
 */
@Injectable()
export class BumpAutoNotificationsService {
  private readonly logger = new Logger(BumpAutoNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly queue: Queue,
  ) {}

  /** D2 — se agotaron las tres bolsas. */
  pausedNoFunds(userId: string, data: PausaData) {
    return this.avisar(userId, data, 'NO_FUNDS');
  }

  /** D9 — el anuncio dejó de estar ACTIVE. */
  pausedListingInactive(userId: string, data: PausaData) {
    return this.avisar(userId, data, 'LISTING_INACTIVE');
  }

  private async avisar(
    userId: string,
    data: PausaData,
    reason: 'NO_FUNDS' | 'LISTING_INACTIVE',
  ): Promise<void> {
    // In-app primero: es el canal que no puede fallar por configuración externa.
    await this.notifications.createNotification(userId, 'BUMP_AUTO_PAUSED', { ...data, reason });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    if (!user) return;

    await this.queue.add(NOTIFICATION_JOB.SEND_BUMP_AUTO_PAUSED, {
      email: user.email,
      name: user.name,
      listingId: data.listingId,
      listingTitle: data.listingTitle,
      reason,
    } satisfies SendBumpAutoPausedData);
  }
}
