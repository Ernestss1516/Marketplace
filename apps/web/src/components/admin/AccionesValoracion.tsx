'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { moderateReview, restoreReview, retireReview } from '@/lib/api/moderacion';
import { ApiError } from '@/lib/api/client';

/**
 * 7b — RETIRAR / RESTAURAR / EDITAR una valoración desde el backoffice.
 *
 * EL MOLDE ES P3a (la edición del anuncio en `/admin/anuncios/[id]`): motivo inline,
 * obligatorio, con el botón deshabilitado hasta los 5 caracteres y la coletilla «queda en
 * el historial». Se copia porque es la misma promesa —toda intervención del staff sobre
 * contenido ajeno deja rastro en `AuditLog`— y porque un moderador ya sabe usarlo.
 *
 * POR QUÉ NO HAY `AlertDialog`. La regla del proyecto lo pide para lo IRREVERSIBLE, y
 * retirar dejó de serlo: la fila vive y «Restaurar» está al lado. Ese es justamente el
 * punto de 7b, así que ponerle la ceremonia del borrado sería contar una mentira sobre lo
 * que hace el botón. El freno aquí es el motivo obligatorio, no un segundo clic.
 *
 * QUIÉN. MODERATOR, no ADMIN, y por B2: retirar es reversible. El gate real está en el
 * backend (`@MinRole(Role.MODERATOR)` en `ModerationController`); esto es la pantalla.
 */
export function AccionesValoracion({
  reviewId,
  retirada,
  rating,
  comment,
  onHecho,
  token,
}: {
  reviewId: string;
  retirada: boolean;
  rating: number;
  comment: string | null;
  /** Recarga la ficha: la fila tiene que repintarse con su nuevo estado. */
  onHecho: () => void | Promise<void>;
  token: string;
}) {
  const [modo, setModo] = useState<'cerrado' | 'retirar' | 'editar'>('cerrado');
  const [motivo, setMotivo] = useState('');
  const [edRating, setEdRating] = useState(String(rating));
  const [edComment, setEdComment] = useState(comment ?? '');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ejecutar(accion: () => Promise<unknown>) {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      await accion();
      setModo('cerrado');
      setMotivo('');
      await onHecho();
    } catch (err) {
      setError(
        err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error al guardar',
      );
    } finally {
      setEnviando(false);
    }
  }

  if (modo === 'cerrado') {
    return (
      <>
        {retirada ? (
          <Button
            size="sm"
            variant="outline"
            disabled={enviando}
            onClick={() => void ejecutar(() => restoreReview(reviewId, token))}
            data-testid="valoracion-restaurar"
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Restaurar'}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setModo('retirar')}
            data-testid="valoracion-retirar"
          >
            Retirar
          </Button>
        )}
        {/* Editar SIEMPRE, retirada o no: corregir el texto de una retirada antes de
            restaurarla es un caso real (se retiró por un dato personal en el comentario,
            se quita el dato, se restaura). */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setModo('editar')}
          data-testid="valoracion-editar"
        >
          Editar
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-md border p-2">
      {modo === 'editar' && (
        <>
          <div>
            <label
              htmlFor={`val-rating-${reviewId}`}
              className="mb-1 block text-xs text-muted-foreground"
            >
              Estrellas
            </label>
            <select
              id={`val-rating-${reviewId}`}
              value={edRating}
              onChange={(e) => setEdRating(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              data-testid="valoracion-edit-rating"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor={`val-comment-${reviewId}`}
              className="mb-1 block text-xs text-muted-foreground"
            >
              Comentario
            </label>
            <textarea
              id={`val-comment-${reviewId}`}
              value={edComment}
              onChange={(e) => setEdComment(e.target.value)}
              rows={3}
              className="w-full rounded-md border bg-background px-2 py-1 text-sm"
              data-testid="valoracion-edit-comment"
            />
          </div>
        </>
      )}

      <div>
        <label
          htmlFor={`val-motivo-${reviewId}`}
          className="mb-1 block text-xs text-muted-foreground"
        >
          Motivo {modo === 'retirar' ? 'de la retirada' : 'del cambio'} (queda en el historial)
        </label>
        <input
          id={`val-motivo-${reviewId}`}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          data-testid="valoracion-motivo"
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={enviando || motivo.trim().length < 5}
          onClick={() =>
            void ejecutar(() =>
              modo === 'retirar'
                ? retireReview(reviewId, token, motivo.trim())
                : moderateReview(reviewId, token, {
                    rating: Number(edRating),
                    comment: edComment.trim(),
                    reason: motivo.trim(),
                  }),
            )
          }
          data-testid="valoracion-confirmar"
        >
          {enviando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : modo === 'retirar' ? (
            'Retirar'
          ) : (
            'Guardar'
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={enviando}
          onClick={() => {
            setModo('cerrado');
            setMotivo('');
            setError(null);
          }}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
