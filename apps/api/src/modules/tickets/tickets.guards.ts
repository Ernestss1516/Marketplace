import { ForbiddenException } from '@nestjs/common';
import { StaffActor } from './tickets.types';

/**
 * PUERTA ADMIN-ONLY POR CONTENIDO DE FILA (R3): un ticket con una factura
 * enlazada solo lo gestiona un ADMIN, nunca un MODERATOR. El `RolesGuard` no
 * puede decidirlo porque depende de la fila, no de la ruta.
 *
 * Vive AQUÍ, fuera de `TicketsService`, desde R5. Motivo: los adjuntos los sirve
 * `TicketAttachmentsService`, que también tiene que aplicarla — y una regla de
 * autorización copiada en dos sitios es una regla que acabará divergiendo en uno
 * de los dos. `TicketsService.assertCanHandle` delega en esta función; el
 * comportamiento (mismo code, mismo mensaje, mismo 403) es idéntico al de R3.
 */
export function assertCanHandleTicket(
  ticket: { invoiceId: string | null },
  actor: StaffActor,
): void {
  if (ticket.invoiceId && actor.role !== 'ADMIN') {
    throw new ForbiddenException({
      code: 'TICKET_BILLING_ADMIN_ONLY',
      message: 'Los tickets con una factura enlazada solo los gestiona un administrador.',
    });
  }
}
