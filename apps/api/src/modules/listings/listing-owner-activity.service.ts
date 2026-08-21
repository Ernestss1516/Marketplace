import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * ÚLTIMA IP (5a) — «EL DUEÑO ESTUVO AQUÍ, Y DESDE ESTA IP».
 *
 * ─── QUÉ RESPONDE, Y POR QUÉ NO LO RESPONDÍA `updatedAt` ──────────────────────
 *
 * `Listing.updatedAt` lo mueve CUALQUIER escritura de la fila, y hoy lo mueven la edición
 * de staff (P3a/2a/2b), el cambio de estado de staff, la etiqueta interna, el borrado de
 * `needsRevalidation` y la transición automática REVIEWED→EDITED. Responde «¿cuándo
 * cambió esta fila?». Esto responde otra cosa: **«¿cuándo actuó su DUEÑO?»**.
 *
 * ─── DÓNDE SE LLAMA, Y POR QUÉ AHÍ ────────────────────────────────────────────
 *
 * **Desde `ListingsController`, el controlador del dueño, y desde ningún otro sitio.** No
 * es una comodidad: es lo que hace que las dos exclusiones sean estructurales en vez de
 * disciplinadas.
 *
 *   · **EL STAFF NO PUEDE ESCRIBIRLA.** Sus acciones viven en `AdminController`, que no
 *     conoce este servicio. No hay que acordarse de no llamarlo: no está a mano. Es el
 *     mismo reparto que P3a hizo con `triage` —el eje del dueño lo mueve el dueño—, y por
 *     la misma razón: si un moderador editara y esto se moviera, el dato afirmaría que el
 *     vendedor estuvo aquí cuando quien estuvo fue el moderador. **Un dato que miente es
 *     peor que uno que falta.**
 *   · **EL CRON DEL BUMP AUTOMÁTICO TAMPOCO.** `bump-auto.processor` llama directamente a
 *     `BillingService.bump(...)`; no pasa por ningún controlador, así que no hay IP que
 *     pasar ni sitio desde donde llamar aquí. Y es correcto: el dueño programó ese bump
 *     hace semanas — no está actuando ahora.
 *
 * VER NO ES GESTIONAR. Los `GET` del dueño —su ficha, sus estadísticas, sus contactos, el
 * teléfono— no llaman aquí. Consultar tu propio anuncio no es un acto de gestión, y
 * contarlo como tal convertiría este campo en un rastro de navegación, que es justo lo que
 * la decisión de privacidad (§6) dice que NO es.
 *
 * ─── FAIL-OPEN ────────────────────────────────────────────────────────────────
 *
 * Anotar la actividad no puede tumbar la acción. Si el vendedor archiva su anuncio y esto
 * falla, el anuncio queda archivado: la casilla vacía es el precio barato. Mismo criterio
 * que la anotación del login y que el contrato de `BadWordService`.
 */
@Injectable()
export class ListingOwnerActivityService {
  private readonly logger = new Logger(ListingOwnerActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Anota que el dueño acaba de gestionar este anuncio desde esta IP.
   *
   * @param ip la del `@Ip()` del controlador — `req.ip` con el `trust proxy` de
   *   `main.ts`, el mismo molde que `AuditLog` y los rate limits. **Sin leer
   *   `x-forwarded-for` a mano**: no se hace en ninguna parte del proyecto y esto no lo
   *   estrena. *(Con la salvedad de RC.1 en `pendientes.md` §6: mientras la topología del
   *   proxy no esté verificada, esta IP puede estar falsificada. Lo dirá la pantalla.)*
   */
  async touch(listingId: string, ip: string): Promise<void> {
    try {
      // `updateMany` y no `update`: si el anuncio ya no existe —se acaba de descartar un
      // borrador, por ejemplo— esto no debe lanzar. Cero filas afectadas es la respuesta
      // correcta, no un error.
      await this.prisma.listing.updateMany({
        where: { id: listingId },
        data: { lastOwnerInteractionAt: new Date(), lastOwnerIp: ip },
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo anotar la actividad del dueño en ${listingId}: ${String(err)}`,
      );
    }
  }
}
