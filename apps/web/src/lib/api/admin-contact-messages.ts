import { apiFetch } from './client';

export type ContactEstado = 'NUEVO' | 'LEIDO' | 'RESPONDIDO' | 'CERRADO';

export interface AdminContactReply {
  id: string;
  contactMessageId: string;
  adminUserId: string;
  admin: { name: string };
  asunto: string;
  cuerpo: string;
  sentAt: string;
}

export interface AdminContactMessage {
  id: string;
  motivoId: string;
  /** RC.2 — relación, no enum. Puede referenciar un motivo ya desactivado
   * (mensajes históricos conservan su motivo intacto). */
  motivo: { id: string; nombre: string };
  email: string;
  telefono: string | null;
  mensaje: string;
  estado: ContactEstado;
  createdAt: string;
  updatedAt: string;
}

export interface AdminContactMessageDetail extends AdminContactMessage {
  replies: AdminContactReply[];
}

export interface PaginatedAdminContactMessages {
  items: AdminContactMessage[];
  total: number;
  page: number;
  perPage: number;
}

export function getAdminContactMessages(
  token: string,
  params: { estado?: ContactEstado; motivoId?: string; page?: number; perPage?: number } = {},
): Promise<PaginatedAdminContactMessages> {
  const qs = new URLSearchParams({ page: String(params.page ?? 1) });
  if (params.estado) qs.set('estado', params.estado);
  if (params.motivoId) qs.set('motivoId', params.motivoId);
  if (params.perPage) qs.set('perPage', String(params.perPage));

  return apiFetch<PaginatedAdminContactMessages>(`/admin/contact-messages?${qs}`, {
    token,
    cache: 'no-store',
  });
}

export function getAdminContactMessage(
  token: string,
  id: string,
): Promise<AdminContactMessageDetail> {
  return apiFetch<AdminContactMessageDetail>(`/admin/contact-messages/${id}`, {
    token,
    cache: 'no-store',
  });
}

export function updateAdminContactMessageEstado(
  token: string,
  id: string,
  estado: ContactEstado,
): Promise<AdminContactMessage> {
  return apiFetch<AdminContactMessage>(`/admin/contact-messages/${id}/estado`, {
    method: 'PATCH',
    body: JSON.stringify({ estado }),
    token,
  });
}

export function replyAdminContactMessage(
  token: string,
  id: string,
  dto: { asunto: string; cuerpo: string },
): Promise<AdminContactMessageDetail> {
  return apiFetch<AdminContactMessageDetail>(`/admin/contact-messages/${id}/responder`, {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}
