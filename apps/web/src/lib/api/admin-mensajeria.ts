import { apiFetch } from './client';

/**
 * MENSAJERÍA C1 — el metadato de las conversaciones, para el staff.
 *
 * **NO HAY AQUÍ NINGUNA FUNCIÓN QUE TRAIGA MENSAJES**, y no es que falte: el
 * cuerpo de las conversaciones es C2, con su decisión de privacidad y su registro
 * de acceso. Lo que C1 sirve es lo que se puede saber sin leer nada de nadie:
 * quién habló con quién, sobre qué, cuándo y cuánto.
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
