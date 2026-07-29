import type {
  AdminTicketDetail,
  AdminTicketFilters,
  AdminTicketsResponse,
  TicketMessage,
  TicketRow,
  TicketTopic,
} from '@/types';
import { toAdjuntoMessage } from '@/components/tickets/attachments';
import { ApiError, apiFetch } from './client';
import { buildReplyForm } from './tickets';

/** Centinelas del filtro de asignación. Los ids son cuid: nunca colisionan. */
export const ASSIGNED_TO_ME = 'me';
export const ASSIGNED_TO_NONE = 'none';

export function getAdminTickets(
  token: string,
  filters: AdminTicketFilters = {},
): Promise<AdminTicketsResponse> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.origin) params.set('origin', filters.origin);
  if (filters.topicId) params.set('topicId', filters.topicId);
  if (filters.assignedTo) params.set('assignedTo', filters.assignedTo);
  params.set('page', String(filters.page ?? 1));
  params.set('perPage', String(filters.perPage ?? 25));
  return apiFetch<AdminTicketsResponse>(`/admin/tickets?${params}`, { token });
}

export function getAdminTicket(id: string, token: string): Promise<AdminTicketDetail> {
  return apiFetch<AdminTicketDetail>(`/admin/tickets/${id}`, { token });
}

export function takeTicket(id: string, token: string): Promise<TicketRow> {
  return apiFetch(`/admin/tickets/${id}/take`, { method: 'POST', token });
}

/**
 * Responder como staff, o dejar una NOTA INTERNA (`internal: true`).
 *
 * `internal` solo existe en ESTA función y en el DTO de staff del backend; la
 * ruta de usuario (`replyTicket` en `lib/api/tickets.ts`) no lo acepta ni lo
 * envía, y el backend la rechazaría con 400 si lo intentara.
 */
export function replyAsStaff(
  id: string,
  body: string,
  token: string,
  internal = false,
  files: File[] = [],
): Promise<{ ticket: TicketRow; message: TicketMessage }> {
  return apiFetch(`/admin/tickets/${id}/messages`, {
    method: 'POST',
    // R5 — con adjuntos va multipart. `internal` viaja como la cadena "true"/"false"
    // (multipart no tiene tipos) y el DTO de staff la convierte SOLO en esos dos
    // casos exactos; cualquier otra cosa la sigue rechazando con 400.
    body: files.length > 0 ? buildReplyForm(body, files, internal) : JSON.stringify({ body, internal }),
    token,
  });
}

export function resolveTicket(id: string, token: string): Promise<TicketRow> {
  return apiFetch(`/admin/tickets/${id}/resolve`, { method: 'POST', token });
}

export function closeTicketAsStaff(id: string, token: string): Promise<TicketRow> {
  return apiFetch(`/admin/tickets/${id}/close`, { method: 'POST', token });
}

export function reassignTicket(
  id: string,
  assignedToId: string,
  token: string,
): Promise<TicketRow> {
  return apiFetch(`/admin/tickets/${id}/reassign`, {
    method: 'POST',
    body: JSON.stringify({ assignedToId }),
    token,
  });
}

/** FLUJO (b) — abrir un hilo con un usuario concreto. */
export function createStaffTicket(
  payload: { userId: string; subject: string; body: string; topicId?: string },
  token: string,
): Promise<TicketRow> {
  return apiFetch('/admin/tickets', { method: 'POST', body: JSON.stringify(payload), token });
}

/**
 * FLUJO (c) — contactar con el usuario reportado desde una denuncia.
 *
 * El DESTINATARIO lo resuelve el SERVIDOR desde el propio Report; la UI no lo
 * manda (el DTO ni siquiera declara `userId`, así que mandarlo daría 400). El
 * `Report` no se modifica: solo se lee.
 */
export function createTicketFromReport(
  reportId: string,
  payload: { subject: string; body: string; topicId?: string },
  token: string,
): Promise<TicketRow> {
  return apiFetch(`/admin/tickets/from-report/${reportId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
    token,
  });
}

/** Motivos disponibles (scope TICKET o BOTH) — el mismo endpoint que usa el usuario. */
export function getStaffTicketTopics(token: string): Promise<TicketTopic[]> {
  return apiFetch<TicketTopic[]>('/tickets/topics', { token });
}

/** Mensajes de dominio de las acciones de staff, traducidos desde el `code` del backend. */
export function toStaffTicketMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Ha ocurrido un error. Inténtalo de nuevo.';

  // R5 — mismos textos que la validación de cliente (ver tickets.ts).
  const adjunto = toAdjuntoMessage(err.code);
  if (adjunto) return adjunto;

  switch (err.code) {
    case 'TICKET_BILLING_ADMIN_ONLY':
      return 'Los tickets con una factura enlazada solo los gestiona un administrador.';
    case 'TICKET_REASSIGN_ADMIN_ONLY':
      return 'Solo un administrador puede reasignar el ticket de otro agente.';
    case 'ASSIGNEE_NOT_STAFF':
      return 'Solo se puede asignar a un administrador o moderador.';
    case 'LINKED_ENTITY_NOT_ALLOWED':
      return 'Ese elemento no se puede enlazar al ticket de este usuario.';
    case 'REPORT_WITHOUT_TARGET_USER':
      return 'Este reporte no identifica a ningún usuario con quien abrir un hilo.';
  }

  if (err.statusCode === 400) return 'La acción no es válida en el estado actual del ticket.';
  if (err.statusCode === 403) return 'No tienes permiso para esta acción.';
  if (err.statusCode === 404) return 'No encontrado.';
  return 'No se ha podido completar la acción. Inténtalo de nuevo.';
}
