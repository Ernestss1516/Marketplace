'use client';

import { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { ChevronUp, Loader2, Send, Star, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { getConversation, sendMessage } from '@/lib/api/mensajes';
import type { ChatMessage, ConversationDetail } from '@/lib/api/mensajes';
import { getEligibility } from '@/lib/api/valoraciones';
import { useApiAction } from '@/lib/api/use-api-action';
import type { EligibilityResult } from '@/lib/api/valoraciones';
import { ReviewModal } from '@/components/valoraciones/ReviewModal';
import { useMessagingSocketContext } from './MessagingSocketContext';

/** Ráfaga en la que se agrupan los "marcar leído" de fondo cuando llegan
 * varios mensajes seguidos por socket — una sola llamada por ráfaga, no una
 * por mensaje (instrucción explícita de Ernest). */
const MARK_READ_DEBOUNCE_MS = 1200;

const EDIT_WINDOW_MS = 72 * 60 * 60 * 1000;

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
  const { run } = useApiAction();
  // Backend returns DESC (newest first); reverse for ASC display in chat
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    [...initialData.messages].reverse(),
  );
  const [nextCursor, setNextCursor] = useState<string | null>(initialData.nextCursor);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // ── Review state ─────────────────────────────────────────────────────────────
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const listingId = initialData.listing.id;
  const targetId = initialData.otherUser.id;
  const targetName = initialData.otherUser.name;

  const { latestMessage, joinConversation } = useMessagingSocketContext();

  async function fetchEligibility() {
    // BORRADO B1 — sin anuncio no hay nada que valorar. Una valoración se ancla a
    // (autor, objetivo, anuncio), así que con el anuncio borrado la pregunta «¿puede
    // valorar?» no tiene respuesta: se deja `eligibility` en null y el botón no se
    // pinta. El hilo sigue leyéndose entero, que es lo que B1 preserva.
    if (listingId === null) return;
    // Non-critical check — auth errors sign out; other errors silently ignored
    await run(
      () => getEligibility(listingId, targetId, token),
      { onSuccess: (result) => setEligibility(result) },
    );
  }

  // Este efecto re-dispara en cada conversación distinta porque ChatClient se
  // remonta al navegar entre /mensajes/[id] (páginas dinámicas distintas) —
  // preserva fetchEligibility() estructuralmente, sin código extra para eso.
  useEffect(() => {
    void fetchEligibility();
    joinConversation(initialData.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData.id]);

  // Compute whether the existing review is still within the 72h edit window
  const canEdit =
    eligibility?.alreadyReviewed &&
    eligibility.existingReview !== null &&
    Date.now() < new Date(eligibility.existingReview.createdAt).getTime() + EDIT_WINDOW_MS;

  // Real-time: receive messages pushed by la conexión compartida (Context).
  // Deduplication by id is idempotent — the sender already added the message
  // optimistically from the REST response, so the socket echo is safely ignored.
  useEffect(() => {
    if (!latestMessage || latestMessage.conversationId !== initialData.id) return;
    const incoming = latestMessage.message;

    flushSync(() => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) return prev;
        return [...prev, incoming];
      });
    });
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });

    // Marcar como leído en segundo plano — con debounce: una ráfaga de varios
    // mensajes seguidos dispara UNA sola llamada, no una por mensaje. Se omite
    // si la pestaña no está enfocada (no tiene sentido marcar como leído lo
    // que el usuario no está mirando).
    if (incoming.senderId !== userId && document.visibilityState === 'visible') {
      if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
      markReadTimerRef.current = setTimeout(() => {
        void getConversation(initialData.id, token);
      }, MARK_READ_DEBOUNCE_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestMessage]);

  useEffect(() => {
    return () => {
      if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
    };
  }, []);

  // Scroll to the most recent messages instantly on first render
  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, []);

  async function handleLoadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    await run(
      () => getConversation(initialData.id, token, { before: nextCursor! }),
      {
        onSuccess: (older) => {
          setMessages((prev) => [...older.messages.reverse(), ...prev]);
          setNextCursor(older.nextCursor);
        },
        // Other errors: silently ignored (user can retry by clicking the button again)
      },
    );
    setLoadingOlder(false);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);
    await run(
      () => sendMessage(initialData.id, trimmed, token),
      {
        onSuccess: (msg) => {
          // flushSync ensures the DOM contains the new message before we scroll.
          // Dedup against prev: if the socket event arrived before this response
          // (race condition), the message is already in state and must not be added again.
          flushSync(() => {
            setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
            setBody('');
          });
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        },
        onError: () => setSendError('No se pudo enviar el mensaje. Inténtalo de nuevo.'),
      },
    );
    setSending(false);
  }

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b bg-background px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight">{targetName}</p>
              {/* BORRADO B1 — el anuncio puede ya no existir. El título se sigue
                  mostrando (viene del snapshot) porque es lo que identifica el
                  hilo; lo que desaparece es el enlace, que llevaría a un 404.
                  TypeScript no lo habría atrapado: `${null}` en una plantilla es
                  un string válido y habría producido `/anuncio/null`. */}
              {initialData.listing.slug ? (
                <Link
                  href={`/anuncio/${initialData.listing.slug}`}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  {initialData.listing.title}
                </Link>
              ) : (
                <p className="truncate text-xs text-muted-foreground">
                  {initialData.listing.title}
                </p>
              )}
            </div>

            {/* Review action */}
            {eligibility?.canReview && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() => setReviewModalOpen(true)}
              >
                <Star className="h-3.5 w-3.5" aria-hidden />
                Valorar
              </Button>
            )}
            {eligibility?.alreadyReviewed && canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() => setReviewModalOpen(true)}
              >
                <Star className="h-3.5 w-3.5" aria-hidden />
                Editar valoración
              </Button>
            )}
            {eligibility?.alreadyReviewed && !canEdit && (
              <Badge variant="secondary" className="shrink-0 gap-1 text-xs">
                <CheckCircle2 className="h-3 w-3" aria-hidden />
                Ya valoraste
              </Badge>
            )}
          </div>
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

      {/* Review modal — rendered outside the chat box to avoid z-index issues.
          BORRADO B1: sin anuncio no se monta. No es sólo por el tipo — `eligibility`
          se queda en null cuando no hay anuncio (ver fetchEligibility), así que el
          botón que lo abre tampoco aparece; esta guarda es la que hace que eso no
          dependa de que las dos condiciones sigan de acuerdo. */}
      {listingId !== null && (
        <ReviewModal
          open={reviewModalOpen}
          onOpenChange={setReviewModalOpen}
          existingReviewId={canEdit ? (eligibility?.existingReview?.id ?? null) : null}
          targetName={targetName}
          listingId={listingId}
          targetId={targetId}
          token={token}
          onSuccess={() => void fetchEligibility()}
          wouldBeVerified={eligibility?.wouldBeVerified}
        />
      )}
    </>
  );
}
