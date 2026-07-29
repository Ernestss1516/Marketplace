'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Link2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useApiAction } from '@/lib/api/use-api-action';
import { createTicket, toCreateTicketMessage } from '@/lib/api/tickets';
import type { CreateTicketPayload, TicketTopic } from '@/types';

/** Entidad prefijada desde el contexto de origen. No editable: el usuario llegó desde ahí. */
export interface LinkedEntity {
  kind: 'listing' | 'review' | 'invoice';
  id: string;
  label: string;
}

const SUBJECT_MAX = 150;
const BODY_MAX = 5000;

interface Props {
  topics: TicketTopic[];
  linked: LinkedEntity | null;
  token: string;
}

export function NuevoTicketClient({ topics, linked, token }: Props) {
  const router = useRouter();
  const { run } = useApiAction();

  const [subject, setSubject] = useState('');
  const [topicId, setTopicId] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La UI RESTRINGE (no deja enviar vacío ni pasarse de largo); el backend
  // GARANTIZA (los mismos límites están en el DTO). Si discrepan, manda el backend.
  const puedeEnviar =
    subject.trim().length >= 3 &&
    subject.length <= SUBJECT_MAX &&
    body.trim().length >= 1 &&
    body.length <= BODY_MAX &&
    !sending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeEnviar) return;

    setSending(true);
    setError(null);

    const payload: CreateTicketPayload = {
      subject: subject.trim(),
      body: body.trim(),
      ...(topicId && { topicId }),
      ...(linked?.kind === 'listing' && { listingId: linked.id }),
      ...(linked?.kind === 'review' && { reviewId: linked.id }),
      ...(linked?.kind === 'invoice' && { invoiceId: linked.id }),
    };

    await run(() => createTicket(payload, token), {
      onSuccess: (ticket) => router.push(`/mis-tickets/${ticket.id}`),
      // 422 (entidad no enlazable), 429 (10/día) y 400 (motivo inválido) tienen
      // copy propio — nunca un throw sin gestionar ni el genérico de siempre.
      onError: (err) => {
        setError(toCreateTicketMessage(err));
        setSending(false);
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" data-testid="form-nuevo-ticket">
      {linked && (
        <div
          className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm"
          data-testid="entidad-enlazada"
        >
          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">Este ticket se relaciona con:</p>
            <p className="text-muted-foreground">{linked.label}</p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="subject">Asunto</Label>
        <Input
          id="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={SUBJECT_MAX}
          placeholder="Resume el problema en una línea"
          required
        />
      </div>

      {topics.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="topicId">Motivo (opcional)</Label>
          <select
            id="topicId"
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">Sin especificar</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="body">Mensaje</Label>
        <Textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={BODY_MAX}
          rows={8}
          placeholder="Cuéntanos qué ha pasado con el mayor detalle posible."
          required
        />
        <p className="text-right text-xs text-muted-foreground">
          {body.length}/{BODY_MAX}
        </p>
      </div>

      {error && (
        <div
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
          data-testid="error-nuevo-ticket"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" disabled={!puedeEnviar} data-testid="enviar-ticket">
        {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Abrir ticket
      </Button>
    </form>
  );
}
