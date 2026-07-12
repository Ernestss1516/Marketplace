import { apiFetch } from './client';

/** RC.2 — motivo configurable por el admin (ya no un enum). Solo lo mínimo
 * para pintar el <select> público: id + nombre visible. */
export interface ContactReasonOption {
  id: string;
  nombre: string;
}

export interface ContactTimeTrapToken {
  issuedAt: number;
  token: string;
}

export interface SubmitContactMessagePayload {
  motivoId: string;
  email: string;
  telefono?: string;
  mensaje: string;
  /** Honeypot (RC.1) — un humano nunca rellena este campo. */
  empresa?: string;
  timeTrapToken: string;
}

/** GET /contacto/motivos — solo motivos activos, ya ordenados por el backend. */
export function getContactMotivos(): Promise<ContactReasonOption[]> {
  return apiFetch<ContactReasonOption[]>('/contacto/motivos');
}

/** GET /contacto/token — token firmado del time-trap anti-bot. Pedir uno nuevo
 * en cada carga del formulario (fetch de cliente normal, sin caché de Next). */
export function getContactTimeTrapToken(): Promise<ContactTimeTrapToken> {
  return apiFetch<ContactTimeTrapToken>('/contacto/token');
}

/** POST /contacto — público, sin auth. Siempre resuelve { success: true } salvo
 * 429 (rate limit) — honeypot y time-trap fallidos también devuelven 200 por
 * diseño (no hay forma de distinguirlos desde el cliente, y así debe ser). */
export function submitContactMessage(
  payload: SubmitContactMessagePayload,
): Promise<{ success: true }> {
  return apiFetch<{ success: true }>('/contacto', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
