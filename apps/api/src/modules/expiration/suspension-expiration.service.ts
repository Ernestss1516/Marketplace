import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AccountModerationNotificationsService } from '../account-moderation-notifications/account-moderation-notifications.service';

/**
 * BORRADO DE CUENTAS C4 — EL CRON QUE PONE LA FILA AL DÍA.
 *
 * ── NO ES LA FUENTE DE VERDAD, Y ESO CAMBIA LO QUE HAY QUE EXIGIRLE ─────────
 *
 * Quien de verdad levanta una suspensión cumplida es el predicado perezoso del
 * gate (`suspensionYaCumplida`, en `account-access.ts`): en cuanto pasa la fecha,
 * la cuenta entra **sin que nadie haya tocado nada**. Este cron no decide nada —
 * sólo escribe lo que ya es cierto.
 *
 * Por eso puede fallar, retrasarse o no existir sin que nadie se quede fuera. Y
 * por eso hace falta igualmente: sin él, `/admin/usuarios` seguiría enseñando
 * «Suspendido» a alguien que ya entra, y la ficha estaría mintiendo. Son dos
 * verdades distintas sobre la misma fila, que es exactamente lo que el cron de
 * entitlements existe para evitar (ver `EntitlementExpirationService`).
 *
 * ── LA FRANJA ───────────────────────────────────────────────────────────────
 *
 * 07:00. Las de 02:00 a 06:00 están ocupadas (anuncios, entitlements,
 * facturación, tickets, impresiones) y el volcado va cada 15 min; los bumps, al
 * minuto 10 de cada hora. Se separa por el mismo criterio que separó las otras:
 * que el fallo de una barrida no bloquee las demás.
 */
@Injectable()
export class SuspensionExpirationService {
  private readonly logger = new Logger(SuspensionExpirationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    // N2 — el aviso de que la suspensión se ha cumplido.
    private readonly accountNotify: AccountModerationNotificationsService,
  ) {}

  @Cron('0 7 * * *')
  async runSuspensionExpiration(): Promise<void> {
    await this.runExpirationSweep();
  }

  /**
   * Punto de entrada público para que los tests la disparen sin esperar al
   * planificador — molde exacto de `EntitlementExpirationService`.
   *
   * IDEMPOTENTE por construcción: el `where` sólo encuentra cuentas que siguen
   * `SUSPENDED` con fecha pasada, así que una segunda pasada no halla nada. Y no
   * hace falta ningún guard extra para eso: al primer `update` dejan de casar.
   */
  async runExpirationSweep(): Promise<number> {
    const ahora = new Date();

    const cumplidas = await this.prisma.user.findMany({
      where: {
        status: UserStatus.SUSPENDED,
        /**
         * `lte: ahora` **y `not: null` implícito**: Prisma no casa `null` con una
         * comparación, así que una suspensión INDEFINIDA no entra aquí ni por
         * accidente. Es la garantía de compatibilidad de C4 — las suspensiones
         * anteriores no llevan fecha y este cron no las toca.
         *
         * Y `status: SUSPENDED` no es redundante con lo anterior: una cuenta
         * ARCHIVED puede llevar `suspendedUntil` guardado (C2 lo conserva a
         * propósito para poder devolverle su sanción al desarchivarla). Sin esta
         * condición, el cron la «desuspendería» a mitad de archivado — que es la
         * peor forma posible de lavar una sanción.
         */
        suspendedUntil: { lte: ahora },
      },
      select: { id: true, suspendedUntil: true },
    });

    for (const user of cumplidas) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          status: UserStatus.ACTIVE,
          suspendedUntil: null,
          // N2 — el motivo vive con la sanción y se va con ella, igual que hace
          // `changeUserStatus` en las transiciones manuales. Una cuenta ACTIVE
          // arrastrando el motivo de la sanción cumplida se lo enseñaría en el
          // login a alguien que ya puede entrar.
          sanctionReason: null,
          sanctionNote: null,
        },
      });

      /**
       * `USER_SUSPENSION_EXPIRED`, Y NO `USER_UNSUSPEND`.
       *
       * La diferencia importa y no es de estilo: `USER_UNSUSPEND` significa «un
       * moderador la levantó», y aquí no la levantó nadie — se cumplió el plazo.
       * Registrarlo con el mismo nombre haría que el historial de la ficha
       * atribuyera a una persona algo que hizo el reloj.
       *
       * `actorId` ES EL PROPIO USUARIO, y hay que decir por qué: `AuditLog.actorId`
       * es NOT NULL con clave ajena a `User` — **no existe un actor «sistema»**, y
       * el schema lo deja escrito al explicar por qué la transición automática de
       * triaje no se audita. Aquí sí merece registro (una sanción que termina es
       * un hecho que alguien puede tener que reconstruir), así que se usa el
       * mismo recurso que el auto-archivado de C2: el sujeto como actor, y el
       * nombre de la acción diciendo la verdad sobre quién actuó.
       */
      await this.auditLog.log({
        action: 'USER_SUSPENSION_EXPIRED',
        actorId: user.id,
        resourceType: 'User',
        resourceId: user.id,
        before: { status: UserStatus.SUSPENDED, suspendedUntil: user.suspendedUntil },
        after: { status: UserStatus.ACTIVE, suspendedUntil: null, automatico: true },
      });

      /**
       * NOTIFICACIONES N2 — TAMBIÉN SE AVISA CUANDO LA LEVANTA EL RELOJ.
       *
       * Y es el caso que MÁS falta hacía de los dos: una suspensión con plazo se
       * cumple sola, así que **la vía normal de recuperar la cuenta pasa por aquí**,
       * no por un moderador pulsando «reactivar». Avisar sólo del camino manual
       * habría dejado mudo justamente el mayoritario, y a la persona esperando sin
       * saber que ya puede entrar.
       *
       * Sin motivo: levantar una sanción no es sancionar (el `UNSUSPENDED` de
       * `changeUserStatus` tampoco lo lleva).
       */
      await this.accountNotify.decidido(user.id, 'UNSUSPENDED', null);
    }

    if (cumplidas.length > 0) {
      this.logger.log(`${cumplidas.length} suspensión(es) cumplida(s) → ACTIVE`);
    }
    return cumplidas.length;
  }
}
