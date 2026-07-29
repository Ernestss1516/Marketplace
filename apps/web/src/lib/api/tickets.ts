import type {
  CreateTicketPayload,
  TicketDetail,
  TicketMessage,
  TicketRow,
  TicketTopic,
  TicketsResponse,
} from '@/types';
import { ApiError, apiFetch } from './client';

/** Motivos ofrecibles al abrir un ticket (scope TICKET o BOTH). */
export function getTicketTopics(token: string): Promise<TicketTopic[]> {
  return apiFetch<TicketTopic[]>('/tickets/topics', { token });
}

export function getMyTickets(token: string, page = 1, perPage = 20): Promise<TicketsResponse> {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  return apiFetch<TicketsResponse>(`/tickets?${params}`, { token });
}

/**
 * El hilo. `before` pagina hacia ATRÁS (mensajes anteriores al del cursor) y
 * los mensajes vienen DESC — mismo contrato que `getConversation` en mensajes.ts.
 */
export function getTicket(
  id: string,
  token: string,
  opts: { before?: string; limit?: number } = {},
): Promise<TicketDetail> {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return apiFetch<TicketDetail>(`/tickets/${id}${qs ? `?${qs}` : ''}`, { token });
}

export function createTicket(payload: CreateTicketPayload, token: string): Promise<TicketRow> {
  return apiFetch('/tickets', { method: 'POST', body: JSON.stringify(payload), token });
}

export function replyTicket(
  id: string,
  body: string,
  token: string,
): Promise<{ ticket: TicketRow; message: TicketMessage }> {
  return apiFetch(`/tickets/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
    token,
  });
}

export function closeTicket(id: string, token: string): Promise<TicketRow> {
  return apiFetch(`/tickets/${id}/close`, { method: 'POST', token });
}

/**
 * Mensajes de error de dominio para abrir un ticket. El backend distingue los
 * casos con `code`; aquí solo se traducen — NO se reimplementa la validación
 * (la UI restringe, el backend garantiza).
 *
 * Ojo con el 422 de enlace: el backend responde lo MISMO tanto si la entidad no
 * existe como si no es tuya, a propósito (no filtra existencia de ids ajenos).
 * El copy de aquí tiene que ser igual de ambiguo, o desharía esa decisión.
 */
export function toCreateTicketMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Ha ocurrido un error. Inténtalo de nuevo.';

  if (err.statusCode === 429) {
    return 'Has abierto demasiados tickets hoy. Vuelve a intentarlo mañana.';
  }
  if (err.statusCode === 422) {
    switch (err.code) {
      case 'MULTIPLE_LINKED_ENTITIES':
        return 'Solo puedes relacionar el ticket con un anuncio, una valoración o una factura.';
      default:
        return 'No puedes relacionar el ticket con ese elemento. Ábrelo sin relacionarlo y cuéntanos el caso.';
    }
  }
  if (err.statusCode === 400) {
    return 'Revisa los datos: el motivo o el mensaje no son válidos.';
  }
  return 'No se ha podido abrir el ticket. Inténtalo de nuevo.';
}

/** Mensajes de error al responder o cerrar un hilo ya existente. */
export function toTicketActionMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Ha ocurrido un error. Inténtalo de nuevo.';

  if (err.statusCode === 400 && err.code === 'REOPEN_WINDOW_EXPIRED') {
    return 'El plazo para reabrir este ticket ha terminado. Abre uno nuevo y lo vemos.';
  }
  if (err.statusCode === 400) return 'Este ticket ya está cerrado.';
  if (err.statusCode === 403) return 'No puedes realizar esta acción sobre este ticket.';
  return 'No se ha podido completar la acción. Inténtalo de nuevo.';
}
