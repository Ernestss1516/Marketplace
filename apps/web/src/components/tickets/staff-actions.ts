import type { Role, TicketStatus } from '@/types';

/**
 * QUÉ ACCIONES OFRECE la vista de staff, según el estado del ticket, el rol del
 * agente y quién lo lleva.
 *
 * Extraído a una función pura a propósito: es la única lógica de decisión real
 * del frontend de R7, la que más barato se rompe, y la que sería más cara de
 * cubrir a base de clics en Playwright (5 estados × 2 roles × 3 situaciones de
 * asignación). Aquí se prueba entera y en milisegundos.
 *
 * PRINCIPIO: la UI restringe por EXPERIENCIA (no enseñar botones que van a dar
 * error); la SEGURIDAD está en el backend, que responde 403 igualmente. Estas
 * banderas son un espejo de sus guards, no un sustituto.
 */
export interface StaffTicketContext {
  status: TicketStatus;
  /** Agente asignado, o null si está en la bandeja sin dueño. */
  assignedToId: string | null;
  /** true si el ticket lleva una factura enlazada. */
  hasInvoice: boolean;
  actorId: string;
  actorRole: Role;
}

export interface StaffTicketActions {
  /** Si false, el agente no debería ni estar viendo este hilo (el backend da 403). */
  puedeGestionar: boolean;
  puedeTomar: boolean;
  puedeResponder: boolean;
  puedeResolver: boolean;
  puedeCerrar: boolean;
  puedeReasignar: boolean;
}

/** Espejo de STAFF_REPLYABLE del backend. */
const STAFF_REPLYABLE: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_USER'];
/** Espejo de RESOLVABLE. */
const RESOLVABLE: TicketStatus[] = ['IN_PROGRESS', 'WAITING_USER'];
/** Espejo de CLOSABLE. CLOSED no está: es irreversible. */
const CLOSABLE: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED'];

export function resolveStaffActions(ctx: StaffTicketContext): StaffTicketActions {
  // PUERTA 1 — un ticket con factura enlazada es ADMIN-only, en TODOS los verbos
  // (no solo ver y responder): poder cerrar a ciegas lo que no puedes leer sería
  // una puerta trasera. Si esta puerta cierra, no se ofrece nada.
  const puedeGestionar = !ctx.hasInvoice || ctx.actorRole === 'ADMIN';
  if (!puedeGestionar) {
    return {
      puedeGestionar: false,
      puedeTomar: false,
      puedeResponder: false,
      puedeResolver: false,
      puedeCerrar: false,
      puedeReasignar: false,
    };
  }

  // PUERTA 2 — reasignar el ticket de OTRO agente es ADMIN-only. Coger uno sin
  // asignar, o mover el propio, sí puede un MODERATOR.
  const esDeOtro = ctx.assignedToId !== null && ctx.assignedToId !== ctx.actorId;
  const puedeReasignar =
    ctx.status !== 'CLOSED' && (!esDeOtro || ctx.actorRole === 'ADMIN');

  return {
    puedeGestionar: true,
    puedeTomar: ctx.status === 'OPEN',
    puedeResponder: STAFF_REPLYABLE.includes(ctx.status),
    puedeResolver: RESOLVABLE.includes(ctx.status),
    puedeCerrar: CLOSABLE.includes(ctx.status),
    puedeReasignar,
  };
}
