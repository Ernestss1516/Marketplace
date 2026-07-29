import Link from 'next/link';
import { Star, MessageSquare, ShieldCheck, LifeBuoy } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { ReviewsPageResponse, Review } from '@/types';
import { ReviewReportButton } from './ReviewReportButton';

// ── Helpers ──────────────────────────────────────────────────────────────────

function Stars({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'h-6 w-6' : size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <span className="flex gap-0.5" aria-label={`${value} de 5 estrellas`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={
            i < Math.round(value)
              ? `${cls} fill-amber-400 text-amber-400`
              : `${cls} fill-transparent text-muted-foreground/30`
          }
          aria-hidden
        />
      ))}
    </span>
  );
}

function DistributionBar({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-4 text-right text-muted-foreground">{label}</span>
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-amber-400 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-6 text-right tabular-nums text-muted-foreground">{count}</span>
    </div>
  );
}

/**
 * `esMia` = el visitante es el DESTINATARIO de esta valoración (está viendo su
 * propio perfil). Solo entonces se ofrece la entrada de ayuda: este componente
 * es PÚBLICO y se sirve a cualquier visitante, así que enseñar el botón siempre
 * ofrecería a todo el mundo una acción que el backend rechaza con 422 salvo al
 * protagonista — justo lo contrario del principio "la UI solo ofrece lo válido".
 */
function ReviewCard({ review, esMia }: { review: Review; esMia: boolean }) {
  const date = new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(review.createdAt));

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <Avatar className="h-8 w-8 text-sm">
          <AvatarImage src={review.author.avatarUrl} alt={review.author.name} />
          <AvatarFallback>{review.author.name[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium">{review.author.name}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Stars value={review.rating} size="sm" />
            <span className="text-xs text-muted-foreground">{date}</span>
            {review.editedAt && (
              <span className="text-xs text-muted-foreground italic">· Editada</span>
            )}
            {!review.verified && (
              <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                No verificada
              </Badge>
            )}
          </div>
        </div>
      </div>

      {review.comment && (
        <p className="text-sm text-muted-foreground leading-relaxed">{review.comment}</p>
      )}

      {!review.listingId && (
        <p className="text-xs italic text-muted-foreground">
          {review.listingTitle
            ? `Sobre: ${review.listingTitle} (anuncio ya no disponible)`
            : 'Anuncio ya no disponible'}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <ReviewReportButton reviewId={review.id} />
        {esMia && (
          <Link
            href={`/mis-tickets/nuevo?reviewId=${review.id}`}
            prefetch={false}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            <LifeBuoy className="h-3.5 w-3.5" />
            ¿Ayuda con esta valoración?
          </Link>
        )}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

interface ReviewsSectionProps {
  data: ReviewsPageResponse;
  sellerName: string;
  /**
   * true cuando el visitante es el dueño del perfil, es decir, el destinatario
   * de estas valoraciones. Default `false` para que las llamadas existentes
   * sigan comportándose exactamente igual (no aparece nada nuevo).
   */
  esMiPerfil?: boolean;
}

export function ReviewsSection({ data, sellerName, esMiPerfil = false }: ReviewsSectionProps) {
  const { average, count, distribution, unverifiedCount, items } = data;
  // count (verificadas) + unverifiedCount = total real de valoraciones — ni
  // "count" solo ni "items.length" (paginado) sirven para saber si hay
  // ALGO que mostrar (Reputación RÁFAGA 3: count ya solo cuenta verificadas).
  const totalCount = count + unverifiedCount;

  return (
    <section aria-labelledby="reviews-heading">
      <div className="mb-4 flex items-baseline gap-2">
        <h2 id="reviews-heading" className="text-lg font-semibold">
          Valoraciones
        </h2>
        {totalCount > 0 && (
          <span className="text-sm text-muted-foreground">
            {totalCount} {totalCount === 1 ? 'valoración' : 'valoraciones'}
          </span>
        )}
      </div>

      {totalCount === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <MessageSquare className="mb-4 h-10 w-10 text-muted-foreground/40" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {sellerName} todavía no tiene valoraciones.
          </p>
        </div>
      ) : (
        <>
          {/* Aggregate — solo valoraciones verificadas (Reputación RÁFAGA 3) */}
          {count > 0 ? (
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-8">
              {/* Average + stars */}
              <div className="flex flex-col items-center gap-1 sm:items-start">
                <span className="text-4xl font-bold tabular-nums">
                  {average?.toFixed(1)}
                </span>
                <Stars value={average ?? 0} size="lg" />
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  de 5 estrellas, {count} verificada{count === 1 ? '' : 's'}
                </span>
              </div>

              {/* Distribution bars */}
              <div className="flex-1 space-y-1.5 pt-1">
                {['5', '4', '3', '2', '1'].map((star) => (
                  <DistributionBar
                    key={star}
                    label={star}
                    count={distribution[star] ?? 0}
                    total={count}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="mb-6 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              {sellerName} todavía no tiene valoraciones verificadas.
            </div>
          )}

          {unverifiedCount > 0 && (
            <p className="mb-4 text-xs text-muted-foreground">
              +{unverifiedCount} valoración{unverifiedCount === 1 ? '' : 'es'} no verificada
              {unverifiedCount === 1 ? '' : 's'} (no {unverifiedCount === 1 ? 'cuenta' : 'cuentan'} para la media).
            </p>
          )}

          {/* Review list — verificadas y no verificadas, cada una etiquetada */}
          <div className="space-y-3">
            {items.map((review) => (
              <ReviewCard key={review.id} review={review} esMia={esMiPerfil} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
