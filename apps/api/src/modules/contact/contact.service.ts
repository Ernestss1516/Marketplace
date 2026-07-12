import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ContactEstado, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QUEUE_NOTIFICATIONS } from '../../infra/queue/queue.constants';
import { NOTIFICATION_JOB } from '../../infra/queue/notification.types';
import { ContactTimeTrapService } from './contact-time-trap.service';
import { ContactRateLimitService } from './contact-rate-limit.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
import { ListContactMessagesDto } from './dto/list-contact-messages.dto';
import { ReplyContactMessageDto } from './dto/reply-contact-message.dto';

const REPLIES_ORDER: Prisma.ContactReplyFindManyArgs = {
  orderBy: { sentAt: 'asc' },
  include: { admin: { select: { name: true } } },
};

// Incluido en list/findOne/reply para que el frontend tenga el nombre del
// motivo sin una llamada adicional — id+nombre solo (no orden/activo, que son
// datos de gestión, no de visualización de un mensaje concreto).
const MOTIVO_SELECT = { select: { id: true, nombre: true } } as const;

type ContactMessageWithMotivo = Prisma.ContactMessageGetPayload<{
  include: { motivo: typeof MOTIVO_SELECT };
}>;

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationsService,
    private readonly timeTrap: ContactTimeTrapService,
    private readonly rateLimit: ContactRateLimitService,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly notificationQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // Público
  // ---------------------------------------------------------------------------

  issueToken(): { issuedAt: number; token: string } {
    return this.timeTrap.issue();
  }

  /**
   * POST /contacto (público, sin guard). Las 3 defensas activas aquí (rate
   * limit, honeypot, time-trap) devuelven respuestas DELIBERADAMENTE distintas:
   * el rate limit es ruidoso (429 explícito, no ayuda a un bot a evadir el
   * honeypot); honeypot y time-trap son silenciosos (200 OK idéntico al envío
   * legítimo, NO se persiste nada) para no enseñarle a un bot qué comprobación
   * falló. Orden: rate limit primero (más barato, corta antes bajo carga).
   */
  async submit(dto: CreateContactMessageDto, ip: string): Promise<{ success: true }> {
    const { limited, retryAfter } = await this.rateLimit.checkAndIncrement(ip);
    if (limited) {
      throw new HttpException(
        { message: 'Demasiados envíos. Inténtalo más tarde.', retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (dto.empresa) {
      this.logger.debug('Contact form honeypot triggered — discarded silently');
      return { success: true };
    }

    if (!this.timeTrap.verify(dto.timeTrapToken)) {
      this.logger.debug('Contact form time-trap failed — discarded silently');
      return { success: true };
    }

    // No silencioso: un motivoId inexistente o desactivado no es una señal de
    // bot (a diferencia de honeypot/time-trap), es un dato inválido — 400
    // normal. Cubre tanto un motivo borrado de la BD como uno desactivado
    // justo entre que el formulario cargó y el envío llegó.
    const reason = await this.prisma.contactReason.findUnique({ where: { id: dto.motivoId } });
    if (!reason || !reason.activo) {
      throw new BadRequestException('Motivo no válido');
    }

    const message = await this.prisma.contactMessage.create({
      data: {
        motivoId: dto.motivoId,
        email: dto.email,
        telefono: dto.telefono ?? null,
        mensaje: dto.mensaje,
      },
    });

    await this.notifyAdmins(message, reason.nombre);

    return { success: true };
  }

  /** Fan-out: una Notification in-app + un email por cada User con role ADMIN
   * — Notification es userId 1:1, no existe un "buzón de rol" (ver RC.1).
   * `motivoNombre` se pasa ya resuelto (no motivoId): el snapshot de
   * Notification.data debe sobrevivir aunque el motivo se renombre o se
   * desactive después — mismo principio de "snapshot autocontenido" que ya
   * regía para el enum. */
  private async notifyAdmins(
    message: { id: string; mensaje: string; email: string },
    motivoNombre: string,
  ): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true, email: true, name: true },
    });

    const extracto =
      message.mensaje.length > 140 ? `${message.mensaje.slice(0, 140)}…` : message.mensaje;

    await Promise.all(
      admins.flatMap((admin) => [
        this.notifications.createNotification(admin.id, 'CONTACT_MESSAGE', {
          messageId: message.id,
          motivo: motivoNombre,
          email: message.email,
          extracto,
        }),
        this.notificationQueue.add(NOTIFICATION_JOB.SEND_CONTACT_NOTIFICATION, {
          adminEmail: admin.email,
          adminName: admin.name,
          messageId: message.id,
          motivo: motivoNombre,
          remitenteEmail: message.email,
          extracto,
        }),
      ]),
    );
  }

  // ---------------------------------------------------------------------------
  // Admin — mismo molde que BannersService: AuditLog dentro de $transaction, sin DELETE.
  // ---------------------------------------------------------------------------

  async list(dto: ListContactMessagesDto) {
    const { estado, motivoId, page = 1, perPage = 25 } = dto;
    const where: Prisma.ContactMessageWhereInput = {
      ...(estado && { estado }),
      ...(motivoId && { motivoId }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.contactMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: { motivo: MOTIVO_SELECT },
      }),
      this.prisma.contactMessage.count({ where }),
    ]);

    return { items, total, page, perPage };
  }

  /** Auto-transiciona NUEVO → LEIDO al abrir — mismo patrón que read/readAt de Notification. */
  async findOne(id: string) {
    const message = await this.prisma.contactMessage.findUnique({
      where: { id },
      include: { replies: REPLIES_ORDER, motivo: MOTIVO_SELECT },
    });
    if (!message) throw new NotFoundException('Mensaje no encontrado');
    if (message.estado !== 'NUEVO') return message;

    return this.prisma.contactMessage.update({
      where: { id },
      data: { estado: 'LEIDO' },
      include: { replies: REPLIES_ORDER, motivo: MOTIVO_SELECT },
    });
  }

  async updateEstado(
    id: string,
    estado: ContactEstado,
    actorId: string,
    ip?: string,
  ): Promise<ContactMessageWithMotivo> {
    const existing = await this.prisma.contactMessage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Mensaje no encontrado');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.contactMessage.update({
        where: { id },
        data: { estado },
        include: { motivo: MOTIVO_SELECT },
      });

      await this.auditLog.log(
        {
          action: 'CONTACT_MESSAGE_STATUS_CHANGE',
          actorId,
          resourceType: 'ContactMessage',
          resourceId: id,
          before: { estado: existing.estado },
          after: { estado: updated.estado },
          ip,
        },
        tx,
      );

      return updated;
    });
  }

  /** `to` del email va SIEMPRE a message.email (inmutable, leído del propio
   * ContactMessage) — nunca un campo libre del admin. Cierra el vector de
   * email header injection. */
  async reply(id: string, dto: ReplyContactMessageDto, actorId: string, ip?: string) {
    const message = await this.prisma.contactMessage.findUnique({ where: { id } });
    if (!message) throw new NotFoundException('Mensaje no encontrado');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.contactReply.create({
        data: { contactMessageId: id, adminUserId: actorId, asunto: dto.asunto, cuerpo: dto.cuerpo },
      });

      const updated = await tx.contactMessage.update({
        where: { id },
        data: { estado: 'RESPONDIDO' },
      });

      await this.auditLog.log(
        {
          action: 'CONTACT_MESSAGE_REPLY',
          actorId,
          resourceType: 'ContactMessage',
          resourceId: id,
          after: { asunto: dto.asunto, estado: updated.estado },
          ip,
        },
        tx,
      );

      return updated;
    });

    await this.notificationQueue.add(NOTIFICATION_JOB.SEND_CONTACT_REPLY, {
      to: message.email,
      asunto: dto.asunto,
      cuerpo: dto.cuerpo,
    });

    return this.prisma.contactMessage.findUniqueOrThrow({
      where: { id: updated.id },
      include: { replies: REPLIES_ORDER, motivo: MOTIVO_SELECT },
    });
  }
}
