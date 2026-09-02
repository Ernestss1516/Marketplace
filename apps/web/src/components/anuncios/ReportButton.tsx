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
import { MOTIVO_REPORTE_ANUNCIO_LABELS } from '@/lib/etiquetas-enums';

// I18N T3-B — los textos LARGOS de este desplegable viven ya en el vocabulario, como
// variante declarada de los cortos del backoffice: una insignia le dice «Spam» a un
// moderador que ya sabe de qué va; a un comprador al que se le pide que clasifique un
// problema hay que explicárselo.
//
// La LISTA y su orden se quedan aquí, que es donde se deciden: `FAKE_REVIEW` no está
// porque no se puede denunciar un anuncio por valoración falsa. Qué se ofrece es de la
// pantalla; cómo se llama, del vocabulario.
const REASON_OPTIONS: { value: ReportReason; label: string }[] = (
  ['SPAM', 'FRAUD', 'INAPPROPRIATE', 'PROHIBITED_ITEM', 'WRONG_CATEGORY', 'OTHER'] as const
).map((value) => ({ value, label: MOTIVO_REPORTE_ANUNCIO_LABELS[value] }));

interface Props {
  listingId: string;
}

export function ReportButton({ listingId }: Props) {
  const { data: session } = useSession();
  const { run } = useApiAction();
  const { loginUrl } = useRequireAuth();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('SPAM');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only authenticated users can report.
  if (!token) return null;

  if (submitted) {
    return (
      <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
        Denuncia enviada. Gracias por ayudarnos a mantener la comunidad segura.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Flag className="h-3 w-3" />
        Denunciar este anuncio
      </button>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || submitting) return;
    setSubmitting(true);
    setError(null);
    await run(
      () => createReport(token, { reason, description: description.trim() || undefined, listingId }),
      {
        onSuccess: () => setSubmitted(true),
        onError: (err) => {
          if (err instanceof ApiError && err.statusCode === 409) {
            setError('Ya has denunciado este anuncio anteriormente.');
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
    <div className="rounded-md border bg-background p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Flag className="h-4 w-4" />
          Denunciar anuncio
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Motivo</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as ReportReason)}
            className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {REASON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            Descripción <span className="font-normal">(opcional)</span>
          </label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe brevemente el problema..."
            rows={3}
            className="resize-none text-sm"
            disabled={submitting}
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" size="sm" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
          Enviar denuncia
        </Button>
      </form>
    </div>
  );
}
