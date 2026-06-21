'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Loader2, Pencil, Trash2, CheckCircle, Lock, Send } from 'lucide-react';
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
} from '@/lib/api/anuncios';
import { ApiError } from '@/lib/api/client';
import type { ListingSummary, PriceType } from '@/types';

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
}

export function MyListingCard({ listing, token, onAction }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const location = [listing.city, listing.province].filter(Boolean).join(', ');
  const editHref = `/mis-anuncios/${listing.id}/editar`;

  async function runAction(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onAction();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error inesperado');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="overflow-hidden">
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
        </div>
      </div>

      {/* Actions */}
      <CardContent className="border-t px-4 pb-4 pt-3">
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

        <div className="flex flex-wrap gap-2">
          {/* Editar — available for DRAFT, ACTIVE, RESERVED */}
          {['DRAFT', 'ACTIVE', 'RESERVED'].includes(listing.status) && (
            <Button asChild variant="outline" size="sm">
              <Link href={editHref}>
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
