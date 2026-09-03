'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Flag, Loader2, X } from 'lucide-react';
import { createReport, type ReportReason } from '@/lib/api/moderacion';
import { ApiError, toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MOTIVO_REPORTE_VALORACION_LABELS } from '@/lib/etiquetas-enums';

// I18N T3-B — TERCERA variante declarada de `ReportReason`, y no es la del anuncio con
// menos entradas: aquí `INAPPROPRIATE` dice «u ofensivo», porque lo que se denuncia es
// lo que alguien ESCRIBIÓ sobre una persona y no un artículo en venta. Colapsarla
// contra la otra larga habría perdido esa palabra en silencio, así que vive aparte y
// con su motivo escrito. La lista y el orden siguen siendo de esta pantalla.
const REASON_OPTIONS: { value: ReportReason; label: string }[] = (
  ['FAKE_REVIEW', 'INAPPROPRIATE', 'SPAM', 'OTHER'] as const
).map((value) => ({ value, label: MOTIVO_REPORTE_VALORACION_LABELS[value] }));

interface Props {
  reviewId: string;
}

export function ReviewReportButton({ reviewId }: Props) {
  const { data: session } = useSession();
  const { run } = useApiAction();
  const { loginUrl } = useRequireAuth();
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
      <p className="text-xs text-success-foreground">
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
        callbackUrl: loginUrl,
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
