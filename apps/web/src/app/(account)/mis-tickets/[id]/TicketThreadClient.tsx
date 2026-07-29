'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ChevronUp, Link2, Loader2, Lock, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { TicketStatusBadge } from '@/components/tickets/TicketStatusBadge';
import { AttachmentList, AttachmentPicker } from '@/components/tickets/TicketAttachments';
import { useApiAction } from '@/lib/api/use-api-action';
import { useTicketSocket } from '@/hooks/useTicketSocket';
import { closeTicket, getTicket, replyTicket, toTicketActionMessage } from '@/lib/api/tickets';
import { cn } from '@/lib/utils';
import type { TicketDetail, TicketMessage } from '@/types';

const PAGE_SIZE = 50;
const DIA_MS = 24 * 60 * 60 * 1000;

function formatFechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Props {
  initialData: TicketDetail;
  token: string;
}

export function TicketThreadClient({ initialData, token }: Props) {
  const { run } = useApiAction();

  // El backend sirve DESC (el más nuevo primero); se invierte para leer el hilo
  // de arriba abajo. Mismo tratamiento que ChatClient.
  const [ticket, setTicket] = useState<TicketDetail>(initialData);
  const [messages, setMessages] = useState<TicketMessage[]>(() =>
    [...initialData.messages].reverse(),
  );
  const [nextCursor, setNextCursor] = useState<string | null>(initialData.nextCursor);
  const [body, setBody] = useState('');
  /** R5 — ficheros elegidos y todavía sin enviar. Se vacían al enviar con éxito. */
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── R9: el hilo se mueve solo ──────────────────────────────────────────────
  // DEDUPLICACIÓN POR ID, y no es opcional: el mensaje que envía este propio
  // usuario vuelve por el socket (está en la sala del hilo), y ya se añadió con
  // la respuesta del POST. Sin esta comprobación se vería dos veces cada uno.
  // Mismo criterio que ChatClient en mensajería.
  //
  // Una NOTA INTERNA no puede llegar por aquí: el gateway no la emite a la sala
  // del hilo ni a la personal del usuario (invariante §10.3 en el canal de tiempo
  // real, ejercida en tickets-realtime.e2e-spec.ts). El filtro de aquí no es esa
  // defensa — la defensa está en el servidor.
  useTicketSocket({
    token,
    ticketId: ticket.id,
    onMessage: ({ ticketId, message }) => {
      if (ticketId !== ticket.id) return;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    },
  });

  // ── Qué acciones ofrece la UI, según la matriz §7.2 ────────────────────────
  // La UI RESTRINGE, el backend GARANTIZA: aquí solo se decide qué se OFRECE.
  // Cada una de estas condiciones tiene su guard equivalente en el servicio, y
  // si discrepan manda el backend (por eso los errores se muestran, no se ocultan).

  // R8 — la ventana la manda el SERVIDOR (es configurable en caliente); tenerla
  // cableada aquí haría que la UI ofreciera reabrir fuera de plazo en cuanto el
  // admin la cambiara. El backend rechazaría igual, pero la pantalla mentiría.
  const ventanaDias = ticket.reopenWindowDays;
  const dentroDeVentana =
    ticket.resolvedAt !== null &&
    Date.now() < new Date(ticket.resolvedAt).getTime() + ventanaDias * DIA_MS;

  /** Responder reabre (T8) cuando está RESOLVED — no hay endpoint /reopen aparte. */
  const puedeEscribir =
    ticket.status === 'OPEN' ||
    ticket.status === 'IN_PROGRESS' ||
    ticket.status === 'WAITING_USER' ||
    (ticket.status === 'RESOLVED' && dentroDeVentana);

  const esReapertura = ticket.status === 'RESOLVED' && dentroDeVentana;

  /** T11 — solo los hilos que abrió el propio usuario. Uno de la administración, no. */
  const puedeCerrar = ticket.origin === 'USER' && ticket.status !== 'CLOSED';

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || sending) return;

    setSending(true);
    setError(null);

    await run(() => replyTicket(ticket.id, body.trim(), token, files), {
      onSuccess: ({ ticket: updated, message }) => {
        setMessages((prev) => [...prev, message]);
        // El estado lo dicta el BACKEND (T5/T6/T8), no se calcula aquí.
        setTicket((prev) => ({
          ...prev,
          status: updated.status,
          lastMessageAt: updated.lastMessageAt,
          resolvedAt: updated.status === 'IN_PROGRESS' ? null : prev.resolvedAt,
        }));
        setBody('');
        setFiles([]);
        setSending(false);
      },
      onError: (err) => {
        setError(toTicketActionMessage(err));
        setSending(false);
      },
    });
  }

  async function handleLoadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);

    await run(() => getTicket(ticket.id, token, { before: nextCursor, limit: PAGE_SIZE }), {
      onSuccess: (page) => {
        setMessages((prev) => [...[...page.messages].reverse(), ...prev]);
        setNextCursor(page.nextCursor);
        setLoadingOlder(false);
      },
      onError: () => setLoadingOlder(false),
    });
  }

  async function handleClose() {
    if (closing) return;
    setClosing(true);
    setError(null);

    await run(() => closeTicket(ticket.id, token), {
      onSuccess: (updated) => {
        setTicket((prev) => ({ ...prev, status: updated.status, closedAt: updated.closedAt ?? null }));
        setClosing(false);
      },
      onError: (err) => {
        setError(toTicketActionMessage(err));
        setClosing(false);
      },
    });
  }

  const enlaceEntidad =
    ticket.listing ? `/anuncio/${ticket.listing.slug}` : ticket.invoice ? '/perfil/facturacion' : null;

  return (
    <div className="space-y-4">
      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <div className="space-y-2 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-xl font-semibold">{ticket.subject}</h1>
          <TicketStatusBadge status={ticket.status} />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {ticket.topic && <span>{ticket.topic.nombre}</span>}
          <span>Abierto el {formatFechaHora(ticket.createdAt)}</span>
        </div>

        {ticket.linkedLabel && (
          <div
            className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm"
            data-testid="entidad-enlazada"
          >
            <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            {enlaceEntidad ? (
              <Link href={enlaceEntidad} className="underline underline-offset-2">
                {ticket.linkedLabel}
              </Link>
            ) : (
              <span>{ticket.linkedLabel}</span>
            )}
          </div>
        )}
      </div>

      {/* ── Hilo ─────────────────────────────────────────────────────────── */}
      <div className="space-y-3" data-testid="hilo-mensajes">
        {nextCursor && (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" onClick={handleLoadOlder} disabled={loadingOlder}>
              {loadingOlder ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ChevronUp className="mr-2 h-4 w-4" />
              )}
              Cargar mensajes anteriores
            </Button>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={cn('flex', m.side === 'USER' ? 'justify-end' : 'justify-start')}
            data-testid={`mensaje-${m.side.toLowerCase()}`}
          >
            <div
              className={cn(
                'max-w-[80%] rounded-lg px-3 py-2 text-sm',
                m.side === 'USER' ? 'bg-primary text-primary-foreground' : 'border bg-muted',
              )}
            >
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              {m.attachments && m.attachments.length > 0 && (
                <AttachmentList
                  ticketId={ticket.id}
                  attachments={m.attachments}
                  token={token}
                />
              )}
              <p
                className={cn(
                  'mt-1 text-[11px]',
                  m.side === 'USER' ? 'text-primary-foreground/70' : 'text-muted-foreground',
                )}
              >
                {m.side === 'STAFF' && 'Soporte · '}
                {formatFechaHora(m.createdAt)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
          data-testid="error-ticket"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Caja de respuesta o aviso de cerrado ──────────────────────────── */}
      {puedeEscribir ? (
        <form onSubmit={handleReply} className="space-y-2" data-testid="form-respuesta">
          {esReapertura && (
            <p className="text-sm text-muted-foreground">
              Este ticket está resuelto. Si el problema sigue, respóndenos y lo reabrimos —
              tienes {ventanaDias} días desde que se resolvió.
            </p>
          )}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder={esReapertura ? 'Cuéntanos qué sigue fallando…' : 'Escribe tu respuesta…'}
            data-testid="input-respuesta"
          />
          <AttachmentPicker files={files} onChange={setFiles} disabled={sending} />
          <div className="flex items-center justify-between gap-2">
            <Button type="submit" disabled={!body.trim() || sending} data-testid="enviar-respuesta">
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {esReapertura ? 'Reabrir y responder' : 'Enviar'}
            </Button>

            {puedeCerrar && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClose}
                disabled={closing}
                data-testid="cerrar-ticket"
              >
                {closing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Ya no lo necesito
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div
          className="flex flex-col items-start gap-2 rounded-md border bg-muted/40 p-4 text-sm"
          data-testid="ticket-cerrado"
        >
          <p className="flex items-center gap-2 font-medium">
            <Lock className="h-4 w-4" />
            {ticket.status === 'CLOSED'
              ? 'Este ticket está cerrado.'
              : 'El plazo para reabrir este ticket ha terminado.'}
          </p>
          <p className="text-muted-foreground">
            Si sigues necesitando ayuda con esto, abre un ticket nuevo y lo vemos.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/mis-tickets/nuevo">Abrir un ticket nuevo</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
