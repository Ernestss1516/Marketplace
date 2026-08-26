import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataExport, DataExportStatus, Role, UserStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { R2Service } from '../../infra/r2/r2.service';
import { QUEUE_DATA_EXPORT } from '../../infra/queue/queue.constants';
import { AuditLogService } from '../audit-log/audit-log.service';
import { DataExportCollector } from './data-export.collector';
import {
  DATA_EXPORT_TTL_DAYS,
  ESTADOS_DE_EXPORTACION_VIVA,
  dataExportFilename,
  dataExportKey,
} from './data-export.constants';
import { BuildDataExportJobData, DATA_EXPORT_JOB } from './data-export.types';
import { construirZip } from './data-export.zip';

/**
 * BORRADO DE CUENTAS C6 — LA EXPORTACIÓN DE DATOS (§7).
 *
 * ── LA OTRA CARA DEL BORRADO ────────────────────────────────────────────────
 *
 * C5 respondía «que no quede nada mío». C6 responde «déjame llevármelo». Son el
 * mismo derecho por los dos lados, y por eso esta ráfaga cierra el diseño: sin
 * ella, la única forma de irse era perderlo todo.
 *
 * ── POR QUÉ NADA DE ESTO OCURRE EN LA PETICIÓN ──────────────────────────────
 *
 * Reunir una veintena de tablas y bajarse N ficheros de R2 no cabe en un HTTP, y
 * la regla del proyecto no admite excepciones. La petición sólo crea la fila y
 * encola; quien trabaja es el worker.
 */
@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly collector: DataExportCollector,
    private readonly auditLog: AuditLogService,
    @InjectQueue(QUEUE_DATA_EXPORT) private readonly queue: Queue,
  ) {}

  // ── Solicitar ───────────────────────────────────────────────────────────────

  /** El usuario, de sí mismo, desde `/perfil` (§7.4). */
  async requestForSelf(userId: string): Promise<DataExport> {
    return this.request(userId, userId);
  }

  /**
   * El staff, de cualquiera. **ADMIN y no MODERATOR**, y el argumento no es de
   * jerarquía sino de contenido: el ZIP lleva las FACTURAS dentro, y el reparto
   * vigente ya dice que la procedencia comercial es ADMIN
   * (`admin.service.ts`, «el dato no sale por esta puerta»). Un ZIP con las
   * facturas **es esa puerta**. La puerta la cierra el `@MinRole(ADMIN)` de
   * `AdminController`; aquí sólo se registra quién pidió qué.
   */
  async requestForUser(
    subjectUserId: string,
    requestedById: string,
    ip?: string,
  ): Promise<DataExport> {
    const exportacion = await this.request(subjectUserId, requestedById);
    await this.auditLog.log({
      action: 'USER_DATA_EXPORT_REQUESTED',
      actorId: requestedById,
      resourceType: 'User',
      resourceId: subjectUserId,
      after: { exportId: exportacion.id },
      ip,
    });
    return exportacion;
  }

  private async request(subjectUserId: string, requestedById: string): Promise<DataExport> {
    const sujeto = await this.prisma.user.findUnique({
      where: { id: subjectUserId },
      select: { id: true, status: true },
    });
    if (!sujeto) throw new NotFoundException('Usuario no encontrado');

    /**
     * UNA CUENTA `ARCHIVED` SÍ SE EXPORTA — es justo cuando más falta hace, porque
     * es el momento en que alguien se está yendo. Una `DELETED`, no: ya no hay
     * datos que exportar y el ZIP saldría con «Usuario eliminado» dentro. Sería
     * exportar el vacío, y además reabriría por la puerta de atrás lo que C5
     * cerró.
     */
    if (sujeto.status === UserStatus.DELETED) {
      throw new BadRequestException(
        'Esta cuenta está eliminada: ya no quedan datos personales que exportar',
      );
    }

    /**
     * EL LÍMITE: UNA VIVA POR USUARIO (§7.3).
     *
     * Se pregunta por el ESTADO DE LAS FILAS y no por un contador en Redis, y la
     * diferencia importa: «cuántas exportaciones vivas tiene esta persona» ya está
     * escrito en `DataExport`, así que un contador aparte sería una segunda fuente
     * de verdad capaz de divergir — un worker que muere dejaría a Redis contando
     * una exportación que no existe, y esa persona sin poder pedir otra. Lo que se
     * limita aquí no es el RITMO, es el número de ZIP simultáneos en el bucket.
     *
     * `FAILED` y `EXPIRED` no cuentan (ver `ESTADOS_DE_EXPORTACION_VIVA`): si
     * contaran, un fallo dejaría a alguien sin su derecho para siempre.
     */
    const viva = await this.prisma.dataExport.findFirst({
      where: { subjectUserId, status: { in: ESTADOS_DE_EXPORTACION_VIVA } },
      orderBy: { createdAt: 'desc' },
    });
    if (viva) {
      throw new ConflictException(
        viva.status === DataExportStatus.PENDING
          ? 'Ya hay una exportación en preparación para esta cuenta'
          : 'Ya hay una exportación lista para descargar; espera a que caduque o descárgala',
      );
    }

    const exportacion = await this.prisma.dataExport.create({
      data: { subjectUserId, requestedById, status: DataExportStatus.PENDING },
    });

    await this.queue.add(DATA_EXPORT_JOB.BUILD, {
      exportId: exportacion.id,
    } satisfies BuildDataExportJobData);

    return exportacion;
  }

  // ── Consultar ───────────────────────────────────────────────────────────────

  /**
   * Las exportaciones de un usuario.
   *
   * NUNCA sale `key`: es una clave privada de R2 y no abre nada por sí sola, pero
   * publicarla enseñaría la forma de las rutas del bucket a cambio de nada.
   *
   * Y `error` **sólo para el staff**. Lo que guarda es el mensaje crudo de la
   * excepción, que puede llevar dentro una clave, una ruta o el nombre de un
   * servicio: al usuario le sirve saber que falló y que puede volver a pedirla
   * —eso lo dice `status`—, no el detalle de por qué. El staff sí lo necesita, y
   * la promesa era que pudiera mirarlo sin abrir los logs.
   */
  async listForSubject(subjectUserId: string, paraStaff = false) {
    const filas = await this.prisma.dataExport.findMany({
      where: { subjectUserId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return filas.map(({ key: _key, error, ...resto }) => ({
      ...resto,
      ...(paraStaff ? { error } : {}),
    }));
  }

  // ── Descargar ───────────────────────────────────────────────────────────────

  /**
   * LA DESCARGA. **Molde exacto de `InvoicingService.getInvoicePdf`**: se busca la
   * fila, se revalida la propiedad, se baja el objeto de R2 y se devuelve el
   * buffer. Cero mecanismo nuevo — y ninguna URL pública, ni prefirmada.
   *
   * NO ES UNA COMODIDAD, ES LA ÚNICA PUERTA: el objeto vive bajo un prefijo
   * privado, así que revocar el acceso es dejar de pasar por aquí. Una URL
   * prefirmada, en cambio, seguiría abriendo el ZIP después de que la cuenta se
   * cerrara, y este ZIP lleva dentro la vida entera de una persona.
   *
   * DOS SUJETOS PUEDEN BAJARLA y sólo dos: **el sujeto** (son sus datos) y un
   * **ADMIN** (§7.4). Ni el MODERATOR ni quien la pidió si dejó de ser ADMIN: el
   * permiso se comprueba AHORA, no cuando se encoló.
   */
  async getExportFile(
    actor: { userId: string; role: Role },
    exportId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const exportacion = await this.prisma.dataExport.findUnique({
      where: { id: exportId },
      include: { subject: { select: { slug: true } } },
    });
    if (!exportacion) throw new NotFoundException('Exportación no encontrada');

    const esElSujeto = exportacion.subjectUserId === actor.userId;
    if (!esElSujeto && actor.role !== Role.ADMIN) {
      throw new ForbiddenException('Esta exportación no es tuya');
    }

    if (exportacion.status === DataExportStatus.PENDING) {
      throw new NotFoundException('La exportación todavía se está preparando');
    }
    if (exportacion.status === DataExportStatus.FAILED) {
      throw new NotFoundException('La exportación falló; vuelve a solicitarla');
    }
    /**
     * CADUCADA ES CADUCADA, y se comprueban las DOS cosas: el estado y la fecha.
     * El cron es quien pone `EXPIRED`, pero puede ir con retraso —o no haber
     * corrido nunca en una máquina recién levantada—, y en esa ventana el objeto
     * todavía está en el bucket. Fiarse sólo del estado serviría un ZIP que ya
     * debería estar muerto; comprobar la fecha aquí cierra esa ventana sin
     * depender del planificador. Mismo patrón que `suspensionYaCumplida` (C4): la
     * verdad se evalúa al decidir, y el cron sólo la materializa.
     */
    if (
      exportacion.status === DataExportStatus.EXPIRED ||
      (exportacion.expiresAt != null && exportacion.expiresAt <= new Date()) ||
      !exportacion.key
    ) {
      throw new NotFoundException('La exportación ha caducado; vuelve a solicitarla');
    }

    const buffer = await this.r2.download(exportacion.key);
    return {
      buffer,
      filename: dataExportFilename(exportacion.subject.slug, exportacion.createdAt),
    };
  }

  // ── El trabajo (lo llama el worker) ─────────────────────────────────────────

  /**
   * Reúne, comprime, sube y marca `READY`. Lo invoca `DataExportProcessor`.
   *
   * IDEMPOTENTE POR EL `where`: si el job se reintenta sobre una exportación que
   * ya está `READY` —o que el usuario canceló— se sale sin trabajar. Un reintento
   * de BullMQ no puede subir un segundo ZIP encima ni resucitar una caducada.
   */
  async buildExport(exportId: string): Promise<void> {
    const exportacion = await this.prisma.dataExport.findUnique({ where: { id: exportId } });
    if (!exportacion) {
      this.logger.warn(`La exportación ${exportId} ya no existe; nada que hacer`);
      return;
    }
    if (exportacion.status !== DataExportStatus.PENDING) {
      this.logger.warn(
        `La exportación ${exportId} ya no está PENDING (${exportacion.status}); no se rehace`,
      );
      return;
    }

    const prefijoPublico = this.r2.getPublicUrl('').replace(/\/$/, '');
    const { datos, ficheros, sujeto } = await this.collector.collect(
      exportacion.subjectUserId,
      prefijoPublico,
    );

    const { buffer, ficherosOmitidos } = await construirZip(datos, ficheros, (key) =>
      this.r2.download(key),
    );

    const key = dataExportKey(exportacion.id);
    await this.r2.upload(key, buffer, 'application/zip');

    const expiresAt = new Date(Date.now() + DATA_EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.dataExport.update({
      where: { id: exportacion.id },
      data: {
        status: DataExportStatus.READY,
        key,
        sizeBytes: buffer.byteLength,
        expiresAt,
        completedAt: new Date(),
        error: null,
      },
    });

    /**
     * EL AVISO. In-app y no sólo por correo: la exportación puede tardar minutos y
     * el usuario ya cerró la pestaña. Snapshot autocontenido —`Notification.data`
     * lo exige por escrito—: si la exportación caduca y se borra, el aviso sigue
     * pudiendo pintarse sin consultas.
     */
    await this.prisma.notification.create({
      data: {
        userId: exportacion.subjectUserId,
        type: 'DATA_EXPORT_READY',
        data: {
          exportId: exportacion.id,
          expiresAt: expiresAt.toISOString(),
          sizeBytes: buffer.byteLength,
        },
      },
    });

    this.logger.log(
      `Exportación ${exportacion.id} lista para ${sujeto.slug}: ` +
        `${buffer.byteLength} bytes, ${ficheros.length - ficherosOmitidos}/${ficheros.length} ficheros`,
    );
  }

  /**
   * El worker agotó sus reintentos. Se deja constancia en la fila para que el
   * usuario vea «falló» en vez de un `PENDING` eterno — y, sobre todo, para que
   * pueda **volver a pedirla**: `FAILED` no cuenta como viva.
   */
  async markFailed(exportId: string, motivo: string): Promise<void> {
    await this.prisma.dataExport.updateMany({
      where: { id: exportId, status: DataExportStatus.PENDING },
      data: { status: DataExportStatus.FAILED, error: motivo.slice(0, 2000) },
    });
  }
}
