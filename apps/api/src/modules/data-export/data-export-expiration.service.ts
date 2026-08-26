import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataExportStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { R2Service } from '../../infra/r2/r2.service';

/**
 * BORRADO DE CUENTAS C6 — EL ZIP NO SE QUEDA PARA SIEMPRE (§7.3).
 *
 * ── ESTE CRON SÍ ES LA FUENTE DE VERDAD, Y ESO LO CAMBIA TODO ───────────────
 *
 * `SuspensionExpirationService` (C4) podía fallar sin consecuencias: quien
 * levantaba de verdad una suspensión cumplida era el predicado perezoso del gate,
 * y el cron sólo ponía la fila al día. Aquí no hay predicado que valga: **el
 * objeto está en el bucket hasta que alguien lo borra**, y quien lo borra es esto.
 * Si no corre, el ZIP con la vida entera de una persona se queda ahí.
 *
 * Lo que sí está cubierto por los dos lados es el ACCESO: `getExportFile`
 * comprueba también la fecha, así que en la ventana entre que caduca y que el cron
 * pasa, la descarga ya no sirve el fichero. El cron no protege el acceso — protege
 * de la acumulación.
 *
 * ── PRIMERO R2, DESPUÉS LA FILA ─────────────────────────────────────────────
 *
 * El orden es deliberado y es el contrario del intuitivo. Si se marcara `EXPIRED`
 * primero y el borrado fallara, la siguiente barrida **ya no encontraría la fila**
 * (el `where` sólo mira `READY`) y el objeto quedaría huérfano en el bucket para
 * siempre: basura que nadie volvería a mirar, con datos personales dentro. Al
 * revés, un borrado que va bien y un `update` que falla deja una fila `READY`
 * apuntando a un objeto que ya no está — y de eso se recupera solo: la descarga
 * comprueba la fecha y la siguiente barrida lo reintenta (borrar una clave
 * inexistente es un no-op en S3).
 *
 * ── LA FRANJA ───────────────────────────────────────────────────────────────
 *
 * 08:00. Las de 02:00 a 07:00 están ocupadas (anuncios, entitlements, facturación,
 * tickets, impresiones, suspensiones). Mismo criterio que las demás: que el fallo
 * de una barrida no bloquee las otras.
 */
@Injectable()
export class DataExportExpirationService {
  private readonly logger = new Logger(DataExportExpirationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  @Cron('0 8 * * *')
  async runDataExportExpiration(): Promise<void> {
    await this.runExpirationSweep();
  }

  /**
   * Punto de entrada público para que los tests la disparen sin esperar al
   * planificador — molde exacto de `EntitlementExpirationService`.
   *
   * IDEMPOTENTE por el `where`: sólo encuentra `READY` con fecha pasada, y al
   * primer `update` dejan de casar.
   */
  async runExpirationSweep(): Promise<number> {
    const ahora = new Date();

    const caducadas = await this.prisma.dataExport.findMany({
      where: {
        status: DataExportStatus.READY,
        expiresAt: { lte: ahora },
      },
      select: { id: true, key: true },
    });

    let borradas = 0;
    for (const exportacion of caducadas) {
      if (exportacion.key) {
        try {
          await this.r2.delete(exportacion.key);
        } catch (err) {
          // No se marca EXPIRED: la fila se queda READY y la siguiente barrida
          // vuelve a intentarlo. Perder el intento es preferible a perder el
          // rastro del objeto (ver el orden, arriba).
          this.logger.warn(
            `No se pudo borrar el ZIP ${exportacion.key} de la exportación ${exportacion.id}: ${String(err)}`,
          );
          continue;
        }
      }

      await this.prisma.dataExport.update({
        where: { id: exportacion.id },
        // `key: null` para que no quede apuntando a un objeto que ya no existe.
        data: { status: DataExportStatus.EXPIRED, key: null },
      });
      borradas += 1;
    }

    if (borradas > 0) {
      this.logger.log(`Exportaciones caducadas y borradas del bucket: ${borradas}`);
    }
    return borradas;
  }
}
