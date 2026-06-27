'use client';

import { useState } from 'react';
import { Star, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { createReview, editReview } from '@/lib/api/valoraciones';
import { ApiError } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';

const MAX_COMMENT = 1000;

interface ReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create mode, string → edit mode */
  existingReviewId: string | null;
  targetName: string;
  listingId: string;
  targetId: string;
  token: string;
  onSuccess: () => void;
  /** Pre-fill values when editing */
  initialRating?: number;
  initialComment?: string;
}

function StarSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const active = hover || value;

  const labels = ['', 'Muy mala', 'Mala', 'Regular', 'Buena', 'Excelente'];

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex gap-1" role="group" aria-label="Puntuación">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`}
            className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
          >
            <Star
              className={[
                'h-8 w-8 transition-colors',
                n <= active
                  ? 'fill-amber-400 text-amber-400'
                  : 'fill-transparent text-muted-foreground/30',
              ].join(' ')}
              aria-hidden
            />
          </button>
        ))}
      </div>
      <p className="h-4 text-xs text-muted-foreground">{active > 0 ? labels[active] : ''}</p>
    </div>
  );
}

export function ReviewModal({
  open,
  onOpenChange,
  existingReviewId,
  targetName,
  listingId,
  targetId,
  token,
  onSuccess,
  initialRating = 0,
  initialComment = '',
}: ReviewModalProps) {
  const isEdit = !!existingReviewId;
  const { run } = useApiAction();

  const [rating, setRating] = useState(initialRating);
  const [comment, setComment] = useState(initialComment);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function handleOpenChange(value: boolean) {
    if (!value) {
      // Reset state on close
      setRating(initialRating);
      setComment(initialComment);
      setError(null);
      setDone(false);
    }
    onOpenChange(value);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating === 0) {
      setError('Selecciona una puntuación antes de enviar.');
      return;
    }
    setSubmitting(true);
    setError(null);
    await run(
      () => isEdit
        ? editReview(existingReviewId, { rating, comment: comment || undefined }, token)
        : createReview({ rating, comment: comment || undefined, listingId, targetId }, token),
      {
        onSuccess: () => {
          setDone(true);
          setTimeout(() => { handleOpenChange(false); onSuccess(); }, 1400);
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            if (err.statusCode === 409) {
              setError('Ya has valorado a este usuario para este anuncio.');
            } else if (err.statusCode === 403) {
              setError(isEdit
                ? 'El plazo de edición de 72 horas ha expirado.'
                : 'No tienes permiso para valorar en esta conversación.');
            } else {
              setError('No se pudo guardar la valoración. Inténtalo de nuevo.');
            }
          } else {
            setError('Error inesperado. Inténtalo de nuevo.');
          }
        },
        callbackUrl: '/login',
      },
    );
    setSubmitting(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Editar valoración' : `Valorar a ${targetName}`}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Puedes modificar tu valoración durante las primeras 72 horas. Quedará marcada como editada.'
              : `Comparte tu experiencia con ${targetName}.`}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <Star className="h-6 w-6 fill-amber-400 text-amber-400" aria-hidden />
            </div>
            <p className="font-medium">
              {isEdit ? '¡Valoración actualizada!' : '¡Gracias por tu valoración!'}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 pt-2">
            <StarSelector value={rating} onChange={setRating} />

            <div className="space-y-1.5">
              <label htmlFor="rv-comment" className="text-sm font-medium">
                Comentario <span className="text-muted-foreground font-normal">(opcional)</span>
              </label>
              <Textarea
                id="rv-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
                placeholder="Describe tu experiencia..."
                rows={3}
                className="resize-none"
              />
              <p className="text-right text-xs text-muted-foreground">
                {comment.length}/{MAX_COMMENT}
              </p>
            </div>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting || rating === 0}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEdit ? 'Guardar cambios' : 'Enviar valoración'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
