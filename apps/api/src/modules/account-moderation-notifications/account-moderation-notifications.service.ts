import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QUEUE_NOTIFICATIONS } from '../../infra/queue/queue.constants';
import {
  NOTIFICATION_JOB,
  type SendAccountModeratedData,
} from '../../infra/queue/notification.types';
import type { AccountModeratedAction } from '../notifications/notification.types';

/**
 * NOTIFICACIONES N2 — LOS AVISOS DE LAS DECISIONES SOBRE LA CUENTA.
 *
 * ── EL HUECO QUE CIERRA ─────────────────────────────────────────────────────
 *
 * Suspender, levantar la suspensión, banear, reinstaurar, cambiar el rol,
 * archivar desde el backoffice y eliminar escribían el estado y el `AuditLog`, y
 * **no avisaban a nadie**. Era el hueco más grave del inventario (§A3.2): a una
 * persona se le cerraba la puerta de su cuenta sin una palabra.
 *
 * ── SERVICIO PROPIO, COMO EL DE MODERACIÓN Y EL DE TICKETS ──────────────────
 *
 * El «a quién se le cuenta qué» es una preocupación distinta de «qué transición
 * es válida», y mantenerla fuera es lo que deja `AdminService` con su lógica
 * intacta. Mismo reparto que `ModerationNotificationsService` y
 * `TicketNotificationsService`, y se heredan sus dos invariantes:
 *
 *   1. **El aviso es efecto, nunca causa.** Nada de aquí escribe en `User`. Se
 *      invoca DESPUÉS de que la transición haya persistido; si falla, no se avisa.
 *   2. **Snapshot autocontenido**: valores ya resueltos y congelados, para que el
 *      aviso siga siendo legible aunque la sanción se levante después.
 *
 * ── Y UNA TERCERA, QUE ES LA DE ESTA RÁFAGA: LA FRONTERA ───────────────────
 *
 * **El motivo VISIBLE sale; la NOTA INTERNA no sale nunca.**
 *
 * Este servicio recibe `motivoVisible: string | null` y punto. No recibe el objeto
 * de la sanción, ni la nota, ni nada de donde pudiera sacarla por descuido: la
 * nota interna se queda en `AdminService`, que la escribe en el `AuditLog` y no la
 * pasa por aquí. Es la separación la que hace la garantía, no el cuidado de quien
 * escriba el próximo método.
 *
 * ── EL CORREO NO ES OPCIONAL ────────────────────────────────────────────────
 *
 * Al revés que en el resto del sistema. Un `SUSPENDED`, un `BANNED` y un
 * `ARCHIVED` **no pueden entrar** —los rechaza el gate de `account-access.ts`—,
 * así que la campana no les llega: se crea como constancia para cuando vuelvan,
 * pero **el canal es el correo**. Sin él, la persona se entera chocando contra el
 * login.
 */
@Injectable()
export class AccountModerationNotificationsService {
  private readonly logger = new Logger(AccountModerationNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly queue: Queue,
  ) {}

  /**
   * El aviso de una decisión sobre la cuenta, por los dos canales.
   *
   * `motivoVisible` es EXCLUSIVAMENTE `User.sanctionReason`. La firma no admite la
   * nota interna, y es deliberado: ver la cabecera.
   */
  async decidido(
    targetId: string,
    action: AccountModeratedAction,
    motivoVisible: string | null,
    extra?: { suspendedUntil?: Date | null; newRole?: string | null },
  ): Promise<void> {
    const suspendedUntil = extra?.suspendedUntil?.toISOString() ?? null;
    const newRole = extra?.newRole ?? null;

    // In-app primero: es el canal que no depende de configuración externa. Para un
    // sancionado es constancia (no puede abrirla hasta que vuelva), no el aviso.
    await this.notifications.createNotification(targetId, 'ACCOUNT_MODERATED', {
      action,
      reason: motivoVisible,
      suspendedUntil,
      newRole,
    });

    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { email: true, name: true },
    });
    if (!user) return;

    await this.queue.add(NOTIFICATION_JOB.SEND_ACCOUNT_MODERATED, {
      email: user.email,
      name: user.name,
      action,
      reason: motivoVisible,
      suspendedUntil,
      newRole,
    } satisfies SendAccountModeratedData);

    this.logger.log(`Aviso de cuenta (${action}) enviado a ${targetId}`);
  }

  /**
   * ELIMINACIÓN — **SÓLO CORREO**, y no es una excepción caprichosa: `deleteAccount`
   * borra todas las notificaciones del usuario en la misma transacción, así que un
   * aviso in-app se destruiría a sí mismo.
   *
   * Recibe el correo y el nombre YA LEÍDOS por el llamante, porque después de vaciar
   * la fila no habría de dónde sacarlos — molde exacto de `reviewModerated`, que se
   * construye con la fila cargada antes de tocarla.
   */
  async eliminado(email: string, name: string, motivoVisible: string | null): Promise<void> {
    await this.queue.add(NOTIFICATION_JOB.SEND_ACCOUNT_MODERATED, {
      email,
      name,
      action: 'DELETED',
      reason: motivoVisible,
      suspendedUntil: null,
      newRole: null,
    } satisfies SendAccountModeratedData);

    this.logger.log(`Aviso de eliminación de cuenta enviado a ${email}`);
  }
}
