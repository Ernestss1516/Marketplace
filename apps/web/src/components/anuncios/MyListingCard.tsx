'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Loader2, Pencil, Trash2, CheckCircle, Lock, Send, RotateCcw, Star, TrendingUp, Eye, Heart } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  publishListing,
  reserveListing,
  markListingSold,
  deleteListing,
  renewListing,
} from '@/lib/api/anuncios';
import { bumpListing } from '@/lib/api/billing';
import { toUserMessage, isCreditError, isCooldownError, formatRetryAfter, toBumpMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { DestacadoDialog } from './DestacadoDialog';
import type { BumpPricing, ListingSummary, PriceType } from '@/types';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activo',
  RESERVED: 'Reservado',
  SOLD: 'Vendido',
  EXPIRED: 'Caducado',
  PENDING_REVIEW: 'En revisión',
  REJECTED: 'Rechazado',
};

const STATUS_VARIANTS: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  DRAFT: 'secondary',
  ACTIVE: 'default',
  RESERVED: 'secondary',
  SOLD: 'outline',
  EXPIRED: 'outline',
  PENDING_REVIEW: 'secondary',
  REJECTED: 'destructive',
};

function formatPrice(price: number, currency: string, priceType: PriceType) {
  if (priceType === 'FREE') return 'Gratis';
  if (priceType === 'NEGOTIABLE') return 'A convenir';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(price);
}

interface Props {
  listing: ListingSummary;
  token: string;
  onAction: () => void;
  bumpPricing: BumpPricing;
}

export function MyListingCard({ listing, token, onAction, bumpPricing }: Props) {
  const { run } = useApiAction();
  const { loginUrl } = useRequireAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bumpError, setBumpError] = useState<React.ReactNode | null>(null);
  const [destacadoOpen, setDestacadoOpen] = useState(false);

  const location = [listing.city, listing.province].filter(Boolean).join(', ');
  const editHref = `/mis-anuncios/${listing.id}/editar`;

  // Bump cooldown: 24 hours since last bump
  const bumpCooldownUntil = listing.bumpedAt
    ? new Date(new Date(listing.bumpedAt).getTime() + 24 * 60 * 60 * 1000)
    : null;
  const bumpOnCooldown = bumpCooldownUntil != null && bumpCooldownUntil > new Date();

  async function runAction(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    await run(fn, {
      onSuccess: () => onAction(),
      onError: (err) => setError(toUserMessage(err)),
      callbackUrl: loginUrl,
    });
    setBusy(null);
  }

  return (
    <Card className="overflow-hidden" data-testid={`listing-card-${listing.id}`}>
      <div className="flex gap-4 p-4">
        {/* Thumbnail */}
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
          {listing.thumbnailUrl ? (
            <Image
              src={listing.thumbnailUrl}
              alt={listing.title}
              fill
              className="object-cover"
              sizes="96px"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Sin foto
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-sm font-medium leading-snug">{listing.title}</p>
            <Badge variant={STATUS_VARIANTS[listing.status] ?? 'outline'} className="shrink-0 text-xs">
              {STATUS_LABELS[listing.status] ?? listing.status}
            </Badge>
          </div>

          <p className="text-base font-bold">
            {formatPrice(listing.price, listing.currency, listing.priceType)}
          </p>

          {location && (
            <p className="text-xs text-muted-foreground">{location}</p>
          )}

          {listing.publishedAt && (
            <p className="text-xs text-muted-foreground">
              Publicado{' '}
              {new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(
                new Date(listing.publishedAt),
              )}
            </p>
          )}
          {listing.expiresAt && listing.status === 'ACTIVE' && (
            <p className="text-xs text-muted-foreground">
              Caduca{' '}
              {new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(
                new Date(listing.expiresAt),
              )}
            </p>
          )}
          {listing.featuredUntil && (
            <p className="flex items-center gap-1 text-xs font-medium text-amber-600">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              Destacado hasta{' '}
              {new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(
                new Date(listing.featuredUntil),
              )}
            </p>
          )}

          {/* H8 Bloque C2 — cifras básicas: vistas + me gusta */}
          <div
            className="flex items-center gap-3 text-xs text-muted-foreground"
            data-testid="listing-stats-basic"
          >
            <span className="flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {listing.viewCount ?? 0} vista{(listing.viewCount ?? 0) === 1 ? '' : 's'}
            </span>
            <span className="flex items-center gap-1">
              <Heart className="h-3.5 w-3.5" />
              {listing.favoritesCount ?? 0} me gusta
            </span>
          </div>
        </div>
      </div>

      {destacadoOpen && (
        <DestacadoDialog
          listing={listing}
          token={token}
          open={destacadoOpen}
          onOpenChange={setDestacadoOpen}
          onSuccess={onAction}
        />
      )}

      {/* Actions */}
      <CardContent className="border-t px-4 pb-4 pt-3">
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
        {bumpError && <p className="mb-2 text-xs text-destructive">{bumpError}</p>}

        <div className="flex flex-wrap gap-2">
          {/* Editar — available for DRAFT, ACTIVE, RESERVED */}
          {['DRAFT', 'ACTIVE', 'RESERVED'].includes(listing.status) && (
            <Button asChild variant="outline" size="sm">
              {/* prefetch={false}: misma mitigación que ListingCard.tsx — parrilla de
                  varias tarjetas, mismo patrón dinámico /mis-anuncios/[id]/editar. */}
              <Link href={editHref} prefetch={false}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Editar
              </Link>
            </Button>
          )}

          {/* Publicar — only DRAFT */}
          {listing.status === 'DRAFT' && (
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => runAction('publish', () => publishListing(listing.id, token))}
            >
              {busy === 'publish' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Publicar
            </Button>
          )}

          {/* Reservar — only ACTIVE */}
          {listing.status === 'ACTIVE' && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => runAction('reserve', () => reserveListing(listing.id, token))}
            >
              {busy === 'reserve' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Lock className="mr-1.5 h-3.5 w-3.5" />
              )}
              Reservar
            </Button>
          )}

          {/* Marcar vendido — ACTIVE or RESERVED */}
          {['ACTIVE', 'RESERVED'].includes(listing.status) && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => runAction('sold', () => markListingSold(listing.id, token))}
            >
              {busy === 'sold' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
              )}
              Marcar vendido
            </Button>
          )}

          {/* Renovar — EXPIRED and ACTIVE */}
          {['EXPIRED', 'ACTIVE'].includes(listing.status) && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => runAction('renew', () => renewListing(listing.id, token))}
            >
              {busy === 'renew' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Renovar
            </Button>
          )}

          {/* Destacar — only ACTIVE, not already featured */}
          {listing.status === 'ACTIVE' && !listing.featuredUntil && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => setDestacadoOpen(true)}
              data-testid="btn-destacar"
            >
              <Star className="mr-1.5 h-3.5 w-3.5" />
              Destacar
            </Button>
          )}

          {/* Bump — only ACTIVE, respects 24h cooldown */}
          {listing.status === 'ACTIVE' && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null || bumpOnCooldown}
              onClick={async () => {
                setBusy('bump');
                setBumpError(null);
                await run(
                  () => bumpListing(token, listing.id),
                  {
                    onSuccess: () => { setBusy(null); onAction(); },
                    onError: (err) => {
                      if (isCreditError(err)) {
                        setBumpError(
                          <>
                            No tienes créditos suficientes para hacer bump.{' '}
                            <Link href="/mis-creditos" className="underline hover:text-foreground">
                              Comprar créditos
                            </Link>
                          </>,
                        );
                      } else if (isCooldownError(err)) {
                        setBumpError(
                          `Ya has subido este anuncio, espera ${formatRetryAfter(err.retryAfter)}.`,
                        );
                      } else {
                        setBumpError(toBumpMessage(err));
                      }
                      setBusy(null);
                    },
                    callbackUrl: loginUrl,
                  },
                );
              }}
              title={
                bumpOnCooldown && bumpCooldownUntil
                  ? `Disponible el ${new Intl.DateTimeFormat('es-ES', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(bumpCooldownUntil)}`
                  : undefined
              }
              data-testid="btn-bump"
            >
              {busy === 'bump' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <TrendingUp className="mr-1.5 h-3.5 w-3.5" />
              )}
              {bumpOnCooldown ? (
                'Bump (espera)'
              ) : bumpPricing.bumpDiscountPercent != null ? (
                <>
                  Bump{' '}
                  <span className="ml-1 line-through opacity-60">
                    {bumpPricing.bumpOriginalCreditCost} cr.
                  </span>{' '}
                  <span className="ml-1">{bumpPricing.bumpCreditCost} cr.</span>
                  <span className="ml-1 font-medium text-amber-600">
                    -{bumpPricing.bumpDiscountPercent}%
                  </span>
                </>
              ) : (
                <>
                  Bump <span className="ml-1">{bumpPricing.bumpCreditCost} cr.</span>
                </>
              )}
            </Button>
          )}

          {/* Eliminar — always available */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy !== null}>
                {busy === 'delete' ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Eliminar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar este anuncio?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se eliminará «{listing.title}» de forma permanente. Esta acción no se puede
                  deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => runAction('delete', () => deleteListing(listing.id, token))}
                >
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
