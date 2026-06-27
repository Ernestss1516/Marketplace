'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Flag, Loader2, X } from 'lucide-react';
import { createReport, type ReportReason } from '@/lib/api/moderacion';
import { ApiError, toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const REASON_OPTIONS: { value: ReportReason; label: string }[] = [
  { value: 'FAKE_REVIEW', label: 'Valoración falsa o manipulada' },
  { value: 'INAPPROPRIATE', label: 'Contenido inapropiado u ofensivo' },
  { value: 'SPAM', label: 'Spam o contenido repetido' },
  { value: 'OTHER', label: 'Otro motivo' },
];

interface Props {
  reviewId: string;
}

export function ReviewReportButton({ reviewId }: Props) {
  const { data: session } = useSession();
  const { run } = useApiAction();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('FAKE_REVIEW');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only authenticated users can report.
  if (!token) return null;

  if (submitted) {
    return (
      <p className="text-xs text-green-700">
        Denuncia enviada. Gracias por ayudarnos.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Flag className="h-3 w-3" />
        Denunciar reseña
      </button>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || submitting) return;
    setSubmitting(true);
    setError(null);
    await run(
      () => createReport(token, { reason, description: description.trim() || undefined, reviewId }),
      {
        onSuccess: () => setSubmitted(true),
        onError: (err) => {
          if (err instanceof ApiError && err.statusCode === 409) {
            setError('Ya has denunciado esta valoración anteriormente.');
          } else {
            setError(toUserMessage(err));
          }
        },
        callbackUrl: '/login',
      },
    );
    setSubmitting(false);
  }

  return (
    <div className="rounded-md border bg-background p-3 mt-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Flag className="h-3.5 w-3.5" />
          Denunciar reseña
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as ReportReason)}
          className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {REASON_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe brevemente el problema… (opcional)"
          rows={2}
          className="resize-none text-sm"
          disabled={submitting}
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" size="sm" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
          Enviar denuncia
        </Button>
      </form>
    </div>
  );
}
