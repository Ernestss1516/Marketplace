'use client';

import { useEffect, useState } from 'react';
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

  // Antes: ConversationList abría su propia conexión. Ahora consume la
  // conexión compartida (MensajesShell) vía Context — mismo efecto sobre el
  // estado local, solo cambia de dónde viene el evento.
  useEffect(() => {
    if (!latestMessage) return;
    const { conversationId, message } = latestMessage;
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
