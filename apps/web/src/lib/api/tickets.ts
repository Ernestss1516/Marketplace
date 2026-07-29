import type {
  CreateTicketPayload,
  TicketDetail,
  TicketMessage,
  TicketRow,
  TicketTopic,
  TicketsResponse,
} from '@/types';
import { toAdjuntoMessage } from '@/components/tickets/attachments';
import { API_URL } from '@/config';
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

/**
 * Responder, con o sin adjuntos (R5).
 *
 * Con ficheros va como `multipart/form-data` y sin ellos sigue yendo como JSON,
 * exactamente igual que antes. No es un capricho: `apiFetch` no pone
 * `Content-Type` cuando el cuerpo es un `FormData` para que el navegador ponga el
 * suyo con el `boundary`, y mandar JSON cuando no hay nada que subir evita el
 * sobrecoste del multipart en el caso normal.
 */
export function replyTicket(
  id: string,
  body: string,
  token: string,
  files: File[] = [],
): Promise<{ ticket: TicketRow; message: TicketMessage }> {
  return apiFetch(`/tickets/${id}/messages`, {
    method: 'POST',
    body: files.length > 0 ? buildReplyForm(body, files) : JSON.stringify({ body }),
    token,
  });
}

/** El nombre del campo (`files`) tiene que coincidir con el `FilesInterceptor` del backend. */
export function buildReplyForm(body: string, files: File[], internal?: boolean): FormData {
  const form = new FormData();
  form.append('body', body);
  if (internal !== undefined) form.append('internal', String(internal));
  for (const file of files) form.append('files', file);
  return form;
}

/**
 * Descarga un adjunto por el endpoint AUTENTICADO y la dispara en el navegador.
 *
 * Molde exacto de la descarga de facturas (`FacturasPanel`): `fetch` con el
 * Bearer → `blob` → object URL → click sintético. **NO hay una URL que se pueda
 * poner en un `<a href>` ni en un `<img src>`**, y esa es justamente la garantía
 * de R5: el fichero no existe fuera de una petición autenticada.
 */
export async function downloadTicketAttachment(
  ticketId: string,
  attachment: { id: string; filename: string },
  token: string,
  scope: 'user' | 'staff' = 'user',
): Promise<void> {
  const base = scope === 'staff' ? '/admin/tickets' : '/tickets';
  const res = await fetch(`${API_URL}${base}/${ticketId}/attachments/${attachment.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new ApiError(res.status, 'No se pudo descargar el adjunto');

  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = attachment.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

  // R5 — los 422 de adjunto se traducen con los MISMOS textos que la validación de
  // cliente, para que forzar la petición no produzca un mensaje distinto del que
  // ya se habría visto sin salir del navegador.
  const adjunto = toAdjuntoMessage(err.code);
  if (adjunto) return adjunto;

  if (err.statusCode === 400 && err.code === 'REOPEN_WINDOW_EXPIRED') {
    return 'El plazo para reabrir este ticket ha terminado. Abre uno nuevo y lo vemos.';
  }
  if (err.statusCode === 400) return 'Este ticket ya está cerrado.';
  if (err.statusCode === 403) return 'No puedes realizar esta acción sobre este ticket.';
  return 'No se ha podido completar la acción. Inténtalo de nuevo.';
}
