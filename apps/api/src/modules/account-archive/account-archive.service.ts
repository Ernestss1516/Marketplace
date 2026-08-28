import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ArchiveReason, ListingPauseOrigin, ListingStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QUEUE_BILLING } from '../../infra/queue/queue.constants';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BILLING_JOB } from '../billing/billing.types';
import { ListingActivationService } from '../listing-activation/listing-activation.service';
import { ListingPauseService } from '../listing-pause/listing-pause.service';
import { ListingGateService } from '../listing-gate/listing-gate.service';
import { ExpirationService } from '../expiration/expiration.service';
import { AccountModerationNotificationsService } from '../account-moderation-notifications/account-moderation-notifications.service';
import {
  describeIllegalUserStatusTransition,
  isLegalUserStatusTransition,
} from '../users/user-status.transitions';

/**
 * BORRADO DE CUENTAS C2 — ARCHIVAR Y DESARCHIVAR.
 *
 * SERVICIO PROPIO, y no un método más en `UsersService` o en `AdminService`,
 * porque tiene DOS ENTRADAS que viven en módulos distintos: el usuario desde
 * `/perfil` (UsersController) y el staff desde `/admin/usuarios`
 * (AdminController). Meterlo en cualquiera de los dos obligaría al otro a
 * importarlo, y AdminModule no importa UsersModule. Mismo criterio por el que
 * `ListingActivationService` es un módulo propio: un gesto que comparten dos
 * llamantes que no se conocen.
 *
 * QUÉ HACE ARCHIVAR, en una frase: la cuenta deja de existir PARA SU DUEÑO —no
 * entra, y su contenido sale del escaparate— pero **no se anonimiza nada**. La
 * fila queda intacta y recuperable. Esa es la decisión D-1 del diseño, y es lo
 * que separa este cuerpo del de eliminar (C5), que sí vacía.
 *
 * Ver docs/diseno-borrado-cuentas.md §4.
 */
@Injectable()
export class AccountArchiveService {
  private readonly logger = new Logger(AccountArchiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly activation: ListingActivationService,
    private readonly pause: ListingPauseService,
    private readonly gate: ListingGateService,
    // N2 — archivar desde el backoffice ya no es mudo. Servicio compartido con
    // `AdminModule`, no una copia.
    private readonly accountNotify: AccountModerationNotificationsService,
    @InjectQueue(QUEUE_BILLING) private readonly billingQueue: Queue,
  ) {}

  // ===========================================================================
  //  ARCHIVAR
  // ===========================================================================

  /**
   * Archiva una cuenta. UN SOLO MÉTODO PARA LAS DOS ENTRADAS — lo que cambia es
   * el par (`reason`, `actorId`), no el efecto:
   *
   *   · el usuario desde `/perfil` → `SELF_REQUEST` con `actorId = null`;
   *   · el staff desde el backoffice → `STAFF_ACTION` con el id del moderador.
   *
   * Y la combinación que obliga a que sean DOS COLUMNAS y no una: `SELF_REQUEST`
   * **con** `actorId` poblado es «lo pidió él, lo ejecutó el staff» — el caso real
   * de un usuario BANNED que ejerce su derecho al olvido y no puede entrar a
   * pulsar el botón. Con una sola columna ese caso no se podría representar.
   */
  async archive(
    targetId: string,
    opts: { reason: ArchiveReason; actorId: string | null; note?: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, status: true, name: true, email: true, role: true, isSystem: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // BORRADO DE CUENTAS C5 — la cuenta «Equipo» no es una persona: no tiene nada
    // que archivar, y esconderla dejaría sin firma los artículos que hereda de
    // los editores eliminados. La misma guarda que impide vaciarla.
    if (user.isSystem) {
      throw new BadRequestException('La cuenta del equipo no se puede archivar.');
    }

    if (!isLegalUserStatusTransition(user.status, UserStatus.ARCHIVED)) {
      throw new BadRequestException(
        describeIllegalUserStatusTransition(user.status, UserStatus.ARCHIVED),
      );
    }

    /**
     * TRANSACCIÓN INTERACTIVA y no la forma de lista, desde el residuo BANNED: el
     * pausado ya no se escribe aquí, lo escribe `ListingPauseService` —el mismo
     * lector que usa el ban— y necesita el cliente de la transacción para que su
     * lectura y su escritura caigan juntas con el cambio de `User.status`. La
     * garantía es la de antes, palabra por palabra: no existe un instante en el que
     * la cuenta esté archivada y sus anuncios sigan en el escaparate.
     */
    const { actualizado, aPausar } = await this.prisma.$transaction(async (tx) => {
      const usuario = await tx.user.update({
        where: { id: targetId },
        data: {
          status: UserStatus.ARCHIVED,
          archivedAt: new Date(),
          archiveReason: opts.reason,
          archivedById: opts.actorId,
          archiveNote: opts.note ?? null,
          /**
           * EL DESTINO DE RESTAURACIÓN — el estado que la cuenta tenía JUSTO AHORA,
           * copiado tal cual. Es lo único que impide que archivar a un usuario
           * BANNED sea la forma de lavarle el ban: `unarchive()` no elige destino,
           * lo lee de aquí. Ver diseño §1.1.
           */
          statusBeforeArchive: user.status,
          /**
           * MATA TODAS LAS SESIONES AL INSTANTE. El gate de C1 ya rechaza a un
           * ARCHIVED en cada petición, así que esto no es lo que cierra la puerta:
           * es lo que hace que se cierre sin depender de que el gate exista. Molde
           * `resetPassword` y el cambio de rol.
           *
           * `suspendedUntil` NO se toca aquí a propósito, aunque la tabla de
           * invariantes del diseño diga «se limpia al salir de SUSPENDED»: si se
           * limpiara, desarchivar a un suspendido le devolvería una suspensión
           * INDEFINIDA en vez de la que tenía. Eso es exactamente la clase de
           * alteración de la sanción que `statusBeforeArchive` existe para evitar,
           * así que el vencimiento viaja con su estado. (Hoy la columna es siempre
           * null — la escribe C4.)
           */
          tokenVersion: { increment: 1 },
        },
        select: { id: true, name: true, email: true, slug: true, status: true },
      });

      // §4.4 — PAUSED y no ARCHIVED: ya es reversible, ya sale del índice y ya
      // libera la cuota. La marca `ARCHIVE` es lo que permite que desarchivar
      // devuelva SÓLO éstos: ni los que el vendedor pausó por su cuenta, ni —desde
      // el residuo BANNED— los que pausó una sanción.
      const pausados = await this.pause.pauseListingsForUser(
        targetId,
        ListingPauseOrigin.ARCHIVE,
        tx,
      );

      // §4.5 — un enlace vivo hacia una cuenta cerrada no debe seguir sirviendo.
      await tx.verificationToken.deleteMany({ where: { userId: targetId } });
      await tx.passwordResetToken.deleteMany({ where: { userId: targetId } });

      return { actualizado: usuario, aPausar: pausados };
    });

    await this.auditLog.log({
      action: 'USER_ARCHIVE',
      actorId: opts.actorId ?? targetId,
      resourceType: 'User',
      resourceId: targetId,
      before: { status: user.status },
      after: {
        status: UserStatus.ARCHIVED,
        archiveReason: opts.reason,
        // `autoArchivado` distingue en el registro las dos entradas sin obligar a
        // cruzarlo con `archivedById`, que en el auto-archivado es el propio
        // sujeto (`AuditLog.actorId` es NOT NULL: no existe actor «sistema»).
        autoArchivado: opts.actorId === null,
        anunciosPausados: aPausar.length,
      },
    });

    // Efectos externos, FUERA de la transacción y sin poder tumbarla: si algo de
    // aquí falla, la cuenta ya está archivada y eso es lo correcto. Reintentar un
    // reindexado es trivial; deshacer un archivado que el usuario pidió, no.
    await this.pause.reindexPaused(aPausar);
    await this.cancelarSuscripciones(targetId);

    /**
     * NOTIFICACIONES N2 — SÓLO CUANDO LO DECIDIÓ LA PLATAFORMA.
     *
     * `STAFF_ACTION` y no `opts.actorId != null`, y la diferencia es exactamente el
     * caso que obligó a que fueran dos columnas: `SELF_REQUEST` **con** `actorId`
     * poblado es «lo pidió él, lo ejecutó el staff» —el usuario baneado que ejerce
     * su derecho al olvido y no puede entrar a pulsar el botón—. Mirar el actor
     * avisaría a esa persona de una decisión que tomó ella misma.
     *
     * Un archivado voluntario no se notifica por el mismo criterio que no se
     * notifica pausar un anuncio propio: el usuario acaba de hacerlo.
     *
     * El motivo visible es `archiveNote`, que es el porqué narrativo — el mismo
     * texto que el staff escribe para el registro. La categoría (`archiveReason`)
     * no se le cuenta: es vocabulario interno.
     */
    if (opts.reason === ArchiveReason.STAFF_ACTION) {
      await this.accountNotify.decidido(targetId, 'ARCHIVED', opts.note ?? null);
    }

    return actualizado;
  }

  // ===========================================================================
  //  DESARCHIVAR
  // ===========================================================================

  /**
   * Devuelve la cuenta a la vida — **al estado que tenía**, no a `ACTIVE`.
   *
   * NO ACEPTA DESTINO, y ésa es toda la idea: lo lee de `statusBeforeArchive`. Un
   * baneado archivado vuelve a BANNED. Si este método admitiera un parámetro de
   * destino, archivar sería el camino corto para levantar un ban sin ser ADMIN.
   */
  async unarchive(targetId: string, actorId: string, ip?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, status: true, statusBeforeArchive: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (user.status !== UserStatus.ARCHIVED) {
      throw new BadRequestException(
        'Solo se pueden desarchivar cuentas archivadas. Una cuenta eliminada no se puede recuperar.',
      );
    }

    // El `?? ACTIVE` es defensa, no comportamiento: toda cuenta archivada por
    // `archive()` lleva su destino escrito. Sólo cubre una fila manipulada a mano.
    const destino = user.statusBeforeArchive ?? UserStatus.ACTIVE;
    if (!isLegalUserStatusTransition(UserStatus.ARCHIVED, destino)) {
      throw new BadRequestException(
        describeIllegalUserStatusTransition(UserStatus.ARCHIVED, destino),
      );
    }

    const actualizado = await this.prisma.user.update({
      where: { id: targetId },
      data: {
        status: destino,
        // §4.2 — los metadatos de archivado viven con ARCHIVED y se limpian al
        // salir. Dejarlos puestos sobre una cuenta viva diría que sigue archivada.
        archivedAt: null,
        archiveReason: null,
        archivedById: null,
        archiveNote: null,
        statusBeforeArchive: null,
      },
      select: { id: true, name: true, email: true, slug: true, status: true },
    });

    const { reactivados, sinCupo } = await this.restaurarAnuncios(targetId);

    await this.auditLog.log({
      action: 'USER_UNARCHIVE',
      actorId,
      resourceType: 'User',
      resourceId: targetId,
      before: { status: UserStatus.ARCHIVED, statusBeforeArchive: user.statusBeforeArchive },
      after: { status: destino, anunciosReactivados: reactivados, anunciosSinCupo: sinCupo },
      ip,
    });

    return { ...actualizado, anunciosReactivados: reactivados, anunciosSinCupo: sinCupo };
  }

  /**
   * Devuelve a ACTIVE los anuncios que pausó el archivado — **y sólo los que
   * quepan**.
   *
   * POR QUÉ UNO A UNO Y NO UN `updateMany`: la cuota se evalúa contra los que YA
   * están activos, así que cada reactivación cambia el resultado de la siguiente.
   * Un `updateMany` los activaría todos de golpe sin preguntar, y un vendedor que
   * perdió Pro mientras estaba archivado se despertaría con veinte anuncios sobre
   * un cupo de cinco — un agujero en la cuota abierto por una operación de otro
   * dominio.
   *
   * `actor: 'seller'` NO ES COSMÉTICO: `ActiveListingLimitRule.appliesTo` devuelve
   * `false` para `staff` («el trabajo de moderación no puede quedar rehén de la
   * cuota de un tercero»), así que pasar `'staff'` aquí —aunque quien pulse el
   * botón sea un moderador— desactivaría la cuota entera y reactivaría todo. La
   * reactivación es del VENDEDOR; el moderador sólo la dispara.
   *
   * LA MARCA SE LIMPIA EN LOS DOS CASOS, quepan o no: el ciclo de archivado ha
   * terminado y la marca describe ese ciclo. Lo que no cupo se queda PAUSED, que
   * es un estado del que el propio vendedor puede salir cuando haga sitio.
   *
   * RESIDUO BANNED — EL FILTRO ES `ARCHIVE`, NO «TIENE MARCA». Ésa es la barrera
   * entera del enum de origen: un usuario baneado (anuncios `PAUSED` con origen
   * `BAN`) al que después se archiva no puede recuperarlos al desarchivarlo, porque
   * desarchivar levanta el archivado y **no la sanción** — vuelve a `BANNED` por
   * `statusBeforeArchive`, y unos anuncios `ACTIVE` de un baneado son exactamente el
   * agujero que este cuerpo cerró. Con el booleano de antes, los dos orígenes eran
   * el mismo valor y esto habría reactivado lo que pausó el ban.
   */
  private async restaurarAnuncios(userId: string): Promise<{ reactivados: number; sinCupo: number }> {
    const marcados = await this.prisma.listing.findMany({
      where: {
        sellerId: userId,
        status: ListingStatus.PAUSED,
        pausedByAccountReason: ListingPauseOrigin.ARCHIVE,
      },
      // El más reciente primero: si no caben todos, los que vuelven son los que
      // estaban vivos hace menos. Determinista, para que dos ejecuciones sobre el
      // mismo estado devuelvan lo mismo.
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        slug: true,
        sellerId: true,
        categoryId: true,
        type: true,
        status: true,
        attributes: true,
        needsRevalidation: true,
      },
    });

    let reactivados = 0;
    let sinCupo = 0;

    for (const listing of marcados) {
      let cabe = true;
      try {
        await this.gate.assertCanBecomeActive(listing, {
          actor: 'seller',
          transition: 'reactivate',
          actorId: userId,
        });
      } catch {
        // La puerta rechaza con un motivo accionable; aquí no se propaga porque
        // un anuncio que no cabe NO puede tumbar el desarchivado de la cuenta.
        cabe = false;
      }

      if (cabe) {
        await this.prisma.listing.update({
          where: { id: listing.id },
          data: {
            status: ListingStatus.ACTIVE,
            // Mismo motivo que `reactivate()`: un pausado «viejo» podría tener un
            // expiresAt ya pasado y el cron lo caducaría en menos de 24 h.
            expiresAt: ExpirationService.expiresAt(new Date()),
            pausedByAccountReason: null,
          },
        });
        await this.activation.listingBecameActive(listing.slug, listing.id);
        reactivados += 1;
      } else {
        await this.prisma.listing.update({
          where: { id: listing.id },
          data: { pausedByAccountReason: null },
        });
        sinCupo += 1;
      }
    }

    return { reactivados, sinCupo };
  }

  // ===========================================================================
  //  La pasarela
  // ===========================================================================

  /**
   * §6.5 — EL EFECTO EXTERNO MÁS PELIGROSO DE TODO EL CUERPO, y el que la
   * auditoría no vio: **una cuenta archivada con Pro sigue pagando**. No hay
   * ninguna clave ajena que lo impida ni ningún cron que lo note.
   *
   * VA POR COLA Y NO EN LÍNEA, y no es ceremonia: si la llamada a Stripe falla
   * —una caída transitoria basta— en línea se perdería en un `catch` y el usuario
   * seguiría pagando en silencio. La cola de facturación ya trae `attempts: 3` con
   * backoff exponencial (`RETRY_JOB_OPTIONS`), así que el reintento sale gratis.
   *
   * Encolar NO PUEDE TUMBAR EL ARCHIVADO: si Redis no responde, la cuenta se
   * archiva igual y queda el log. Es la misma asimetría que el borrado de
   * anuncios: la fila ya no está y eso es lo correcto.
   */
  private async cancelarSuscripciones(userId: string): Promise<void> {
    try {
      await this.billingQueue.add(BILLING_JOB.CANCEL_SUBSCRIPTIONS, { userId });
    } catch (err) {
      this.logger.error(
        `No se pudo encolar la cancelación de suscripciones de ${userId}: ${String(err)}`,
      );
    }
  }
}
