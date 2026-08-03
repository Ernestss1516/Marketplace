'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ConversationSummary } from '@/lib/api/mensajes';
import { useMessagingSocketContext } from './MessagingSocketContext';

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(dateStr).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

interface Props {
  initialConversations: ConversationSummary[];
  userId: string;
  /** Conversación abierta en el panel de chat (null si ninguna) — resalta la
   * fila y fuerza su unreadCount a 0 sin esperar ningún round-trip. */
  selectedId: string | null;
}

export function ConversationList({ initialConversations, userId, selectedId }: Props) {
  const [conversations, setConversations] = useState(initialConversations);
  const { latestMessage } = useMessagingSocketContext();

  /**
   * Ids de mensaje ya contados en el badge. SIN esto, el contador se inflaba.
   *
   * `latestMessage` vive en el Provider (MensajesShell), que está POR ENCIMA de
   * este componente y sobrevive a navegar entre la bandeja y una conversación.
   * Este componente, en cambio, se monta y desmonta en esas navegaciones — y al
   * montarse, el efecto de abajo corría otra vez con el MISMO `latestMessage` de
   * antes y lo volvía a sumar. Medido: el servidor decía 1 no leído y la UI
   * mostraba 8; solo se corregía con una recarga dura.
   *
   * `ChatClient`, el otro consumidor del mismo `latestMessage`, ya lo hacía bien
   * (`if (prev.some((m) => m.id === incoming.id)) return prev`). Aquí faltaba: el
   * incremento optimista es deliberado —el badge debe subir en cuanto llega el
   * socket, sin round-trip— pero le faltaba la parte de no contar dos veces.
   *
   * Inicialización perezosa a propósito: lo que ya estuviera en el contexto al
   * montar viene YA reflejado en `initialConversations` (datos del servidor), así
   * que se marca como visto para no re-contarlo tras un remount. Solo se cuentan
   * los mensajes que llegan DESPUÉS de montar, que es justo la inmediatez que se
   * quería.
   */
  const contados = useRef<Set<string> | null>(null);
  if (contados.current === null) {
    contados.current = new Set(latestMessage ? [latestMessage.message.id] : []);
  }

  // Antes: ConversationList abría su propia conexión. Ahora consume la
  // conexión compartida (MensajesShell) vía Context — mismo efecto sobre el
  // estado local, solo cambia de dónde viene el evento.
  useEffect(() => {
    if (!latestMessage) return;
    const { conversationId, message } = latestMessage;
    // Ya contado (o ya venía en los datos del servidor al montar) — no re-contar.
    if (contados.current!.has(message.id)) return;
    contados.current!.add(message.id);
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === conversationId);
      if (idx === -1) return prev; // unknown conversation — ignore

      const updated = [...prev];
      const conv = { ...updated[idx], lastMessageAt: message.createdAt };
      // Only count as unread when the message comes from the other participant.
      // The sender sees their own message via the REST response, not as unread.
      if (message.senderId !== userId) {
        conv.unreadCount = updated[idx].unreadCount + 1;
      }
      updated[idx] = conv;
      updated.sort(
        (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
      );
      return updated;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestMessage]);

  if (conversations.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <MessageCircle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Aún no tienes conversaciones.</p>
        <p className="text-sm text-muted-foreground">
          Contacta con un vendedor desde la ficha de cualquier anuncio.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="border-b px-4 py-3 text-lg font-bold">Mensajes</h1>
      <div className="divide-y">
        {conversations.map((conv) => {
          const isSelected = conv.id === selectedId;
          // La seleccionada se ve siempre como leída — está delante del
          // usuario ahora mismo, aunque el servidor aún no lo sepa (el
          // marcado real llega por el GET de ChatClient al montar).
          const unreadCount = isSelected ? 0 : conv.unreadCount;
          return (
            <Link
              key={conv.id}
              href={`/mensajes/${conv.id}`}
              className={cn(
                'flex items-center gap-4 px-4 py-4 transition-colors hover:bg-muted/50',
                isSelected && 'bg-muted',
              )}
            >
              {/* Listing thumbnail */}
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
                {conv.listing.thumbnailUrl ? (
                  <Image
                    src={conv.listing.thumbnailUrl}
                    alt={conv.listing.title}
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <MessageCircle className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
              </div>

              {/* Listing title + other user */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{conv.listing.title}</p>
                <p className="truncate text-xs text-muted-foreground">{conv.otherUser.name}</p>
              </div>

              {/* Date + unread badge */}
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {formatRelativeTime(conv.lastMessageAt)}
                </span>
                {unreadCount > 0 && (
                  <Badge className="h-5 min-w-[20px] justify-center px-1.5 text-xs">
                    {unreadCount}
                  </Badge>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
