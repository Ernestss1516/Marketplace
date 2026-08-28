import { apiFetch } from './client';

/**
 * MENSAJERÍA EN EL BACKOFFICE — las dos mitades, y son distintas a propósito.
 *
 * `getConversaciones*` (C1) da METADATO: quién habló con quién, sobre qué, cuándo
 * y cuántos mensajes. No sale una línea de contenido y no se registra nada — se
 * carga en cada visita a una ficha.
 *
 * `abrirConversacion` (C2) da el CONTENIDO ÍNTEGRO, y **cada llamada deja una
 * fila de `AuditLog`**. No es un efecto secundario: al abrirse el contenido a
 * MODERATOR+, el rol dejó de filtrar y el registro es lo único que separa la
 * capacidad del abuso. Quien llame a esto debe saber que deja rastro, y la
 * pantalla se lo dice al usuario.
 */

/** Cabecera de una conversación. Sin una sola línea de su contenido. */
export interface ConversacionCabecera {
  id: string;
  createdAt: string;
  lastMessageAt: string;
  /**
   * El anuncio, o `null` si se borró. Cuando es `null`, `listingTitle` es lo
   * único que queda para decir de qué iba el hilo — el `SetNull` de
   * `Conversation.listingId` existe para que el vendedor no pueda destruir la
   * conversación del comprador borrando su anuncio.
   */
  listing: { id: string; title: string; status: string } | null;
  listingTitle: string | null;
  /** `name` puede ser null: una cuenta eliminada conserva su fila vaciada. */
  buyer: { id: string; name: string | null };
  seller: { id: string; name: string | null };
  _count: { messages: number };
}

export interface ConversacionesPaginadas {
  items: ConversacionCabecera[];
  total: number;
  page: number;
  perPage: number;
}

/** Las dos caras de una persona: lo que preguntó y lo que le preguntaron. */
export type PapelConversacion = 'comprador' | 'vendedor' | 'ambos';

/** Un mensaje del hilo, tal cual se guardó. */
export interface MensajeStaff {
  id: string;
  body: string;
  createdAt: string;
  /** Si el destinatario lo leyó. Abrir desde staff NO lo cambia. */
  readAt: string | null;
  sender: { id: string; name: string | null };
}

export interface ConversacionCompleta extends Omit<ConversacionCabecera, '_count'> {
  messages: MensajeStaff[];
}

/**
 * C2 — abre el hilo entero.
 *
 * **DEJA UNA FILA DE `AuditLog` EN EL SERVIDOR** con quién abrió, qué hilo y desde
 * dónde. Una por llamada: lo que hay que poder auditar es cada acceso, no que
 * alguna vez se accediera.
 */
export function abrirConversacion(
  token: string,
  id: string,
): Promise<ConversacionCompleta> {
  return apiFetch<ConversacionCompleta>(`/admin/conversations/${id}`, { token });
}

export function getConversacionesDeAnuncio(
  token: string,
  listingId: string,
  params?: { page?: number; perPage?: number },
): Promise<ConversacionesPaginadas> {
  const qs = new URLSearchParams({ listingId, page: String(params?.page ?? 1) });
  if (params?.perPage) qs.set('perPage', String(params.perPage));
  return apiFetch<ConversacionesPaginadas>(`/admin/conversations?${qs}`, { token });
}

export function getConversacionesDeUsuario(
  token: string,
  userId: string,
  params?: { papel?: PapelConversacion; page?: number; perPage?: number },
): Promise<ConversacionesPaginadas> {
  const qs = new URLSearchParams({ userId, page: String(params?.page ?? 1) });
  if (params?.papel) qs.set('papel', params.papel);
  if (params?.perPage) qs.set('perPage', String(params.perPage));
  return apiFetch<ConversacionesPaginadas>(`/admin/conversations?${qs}`, { token });
}
