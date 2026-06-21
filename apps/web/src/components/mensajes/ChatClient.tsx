'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { ChevronUp, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getConversation, sendMessage } from '@/lib/api/mensajes';
import type { ChatMessage, ConversationDetail } from '@/lib/api/mensajes';
import { useMessagingSocket } from '@/hooks/useMessagingSocket';

interface Props {
  initialData: ConversationDetail;
  token: string;
  userId: string;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ChatClient({ initialData, token, userId }: Props) {
  // Backend returns DESC (newest first); reverse for ASC display in chat
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    [...initialData.messages].reverse(),
  );
  const [nextCursor, setNextCursor] = useState<string | null>(initialData.nextCursor);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Real-time: receive messages pushed by the server via WebSocket.
  // Deduplication by id is idempotent — the sender already added the message
  // optimistically from the REST response, so the socket echo is safely ignored.
  useMessagingSocket({
    token,
    conversationId: initialData.id,
    onMessage({ message: incoming }) {
      flushSync(() => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === incoming.id)) return prev;
          return [...prev, incoming];
        });
      });
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    },
  });

  // Scroll to the most recent messages instantly on first render
  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, []);

  async function handleLoadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const older = await getConversation(initialData.id, token, { before: nextCursor });
      // Prepend older messages (also in DESC from API, reverse to ASC before prepending)
      setMessages((prev) => [...older.messages.reverse(), ...prev]);
      setNextCursor(older.nextCursor);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const msg = await sendMessage(initialData.id, trimmed, token);
      // flushSync ensures the DOM contains the new message before we scroll.
      // Dedup against prev: if the socket event arrived before this response
      // (race condition), the message is already in state and must not be added again.
      flushSync(() => {
        setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
        setBody('');
      });
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch {
      setSendError('No se pudo enviar el mensaje. Inténtalo de nuevo.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-12rem)] flex-col overflow-hidden rounded-lg border">
      {/* Header */}
      <div className="border-b bg-background px-4 py-3">
        <p className="font-semibold leading-tight">{initialData.otherUser.name}</p>
        <Link
          href={`/anuncio/${initialData.listing.slug}`}
          className="text-xs text-muted-foreground hover:underline"
        >
          {initialData.listing.title}
        </Link>
      </div>

      {/* Messages area */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {/* Load older messages */}
        {nextCursor && (
          <div className="flex justify-center pb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadOlder}
              disabled={loadingOlder}
            >
              {loadingOlder ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ChevronUp className="mr-2 h-4 w-4" />
              )}
              Cargar mensajes anteriores
            </Button>
          </div>
        )}

        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sé el primero en escribir.
          </p>
        )}

        {messages.map((msg) => {
          const isOwn = msg.senderId === userId;
          return (
            <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
              <div
                className={[
                  'max-w-[75%] rounded-2xl px-4 py-2',
                  isOwn
                    ? 'rounded-br-sm bg-primary text-primary-foreground'
                    : 'rounded-bl-sm bg-muted text-foreground',
                ].join(' ')}
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.body}</p>
                <p
                  className={[
                    'mt-1 text-right text-[10px]',
                    isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground',
                  ].join(' ')}
                >
                  {formatTime(msg.createdAt)}
                </p>
              </div>
            </div>
          );
        })}

        {/* Scroll anchor — always at the bottom of the message list */}
        <div ref={bottomRef} />
      </div>

      {/* Send form */}
      <form onSubmit={handleSend} className="border-t bg-background p-4">
        {sendError && <p className="mb-2 text-xs text-destructive">{sendError}</p>}
        <div className="flex gap-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend(e as unknown as React.FormEvent);
              }
            }}
            placeholder="Escribe un mensaje… (Enter para enviar, Shift+Enter para saltar de línea)"
            rows={2}
            className="resize-none"
            disabled={sending}
          />
          <Button
            type="submit"
            size="icon"
            className="shrink-0 self-end"
            disabled={sending || !body.trim()}
            aria-label="Enviar mensaje"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
