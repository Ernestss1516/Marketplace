'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ConversationSummary } from '@/lib/api/mensajes';
import { useMessagingSocket } from '@/hooks/useMessagingSocket';

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
  token: string;
  userId: string;
}

export function BandejaMensajesClient({ initialConversations, token, userId }: Props) {
  const [conversations, setConversations] = useState(initialConversations);

  // No conversationId here — the socket auto-joins user:${userId} on connect,
  // so message:new events for all conversations arrive without joining each room.
  useMessagingSocket({
    token,
    onMessage({ conversationId, message }) {
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
        // Re-sort so the most recently active conversation floats to the top
        updated.sort(
          (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
        );
        return updated;
      });
    },
  });

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <MessageCircle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Aún no tienes conversaciones.</p>
        <p className="text-sm text-muted-foreground">
          Contacta con un vendedor desde la ficha de cualquier anuncio.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y rounded-lg border">
      {conversations.map((conv) => (
        <Link
          key={conv.id}
          href={`/mensajes/${conv.id}`}
          className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-muted/50"
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
            {conv.unreadCount > 0 && (
              <Badge className="h-5 min-w-[20px] justify-center px-1.5 text-xs">
                {conv.unreadCount}
              </Badge>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
