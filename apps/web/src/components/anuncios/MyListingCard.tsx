'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Loader2, Pencil, Trash2, CheckCircle, Lock, Send, RotateCcw, Star, TrendingUp, Eye, Heart, UserPlus, PauseCircle, PlayCircle, Archive, LifeBuoy } from 'lucide-react';
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
  deleteListing,
  renewListing,
  pauseListing,
  reactivateListing,
  archiveListing,
} from '@/lib/api/anuncios';
import { formatListingPrice } from './listing-card-shared';
import { bumpListing } from '@/lib/api/billing';
import { toUserMessage, isCreditError, isCooldownError, formatRetryAfter, toBumpMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { resolveBumpCooldown, bumpCooldownTitle } from '@/lib/bump-cooldown';
import { DestacadoDialog } from './DestacadoDialog';
import { CloseDealDialog } from './CloseDealDialog';
import type { BumpPricing, ListingSummary } from '@/types';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  ACTIVE: 'Activo',
  RESERVED: 'Reservado',
  SOLD: 'Vendido',
  EXPIRED: 'Caducado',
  PENDING_REVIEW: 'En revisión',
  REJECTED: 'Rechazado',
  PAUSED: 'Pausado',
  ARCHIVED: 'Archivado',
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
  PAUSED: 'secondary',
  ARCHIVED: 'outline',
};

/** Ciclo de vida RÁFAGA 2 — estados desde los que se puede archivar (irreversible). */
const ARCHIVABLE_STATUSES = ['ACTIVE', 'PAUSED', 'SOLD', 'EXPIRED', 'REJECTED'];


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
  const [dealDialogOpen, setDealDialogOpen] = useState(false);

  const location = [listing.city, listing.province].filter(Boolean).join(', ');
  const editHref = `/mis-anuncios/${listing.id}/editar`;

  /**
   * UXV.3 (A7-flujo) — si el usuario sale de aquí a comprar créditos porque no le llegaba
   * el saldo, esto es a dónde debe volver: la FICHA de este anuncio, no el listado. En la
   * ficha, `ListingOwnerActions` tiene Destacar y Bump de ESTE anuncio a un clic; en
   * `/mis-anuncios` habría que volver a buscar la tarjeta entre todas. Solo los ACTIVE
   * tienen página pública, así que el resto cae al listado.
   */
  const returnTo = listing.status === 'ACTIVE' ? `/anuncio/${listing.slug}` : '/mis-anuncios';
  const comprarCreditosHref = `/mis-creditos?volver=${encodeURIComponent(returnTo)}`;

  // UXV.1 (A2) — el cooldown lo dice la API (`nextBumpAt`), no esta tarjeta. Antes aquí
  // se calculaba `bumpedAt + 24h` mientras el backend solo rechaza dentro de 1 h: el
  // botón quedaba muerto 23 horas de más, con un tooltip de fecha inventada. La ficha
  // pública (ListingOwnerActions) pasa por esta misma función y el mismo campo.
  const { active: bumpOnCooldown, until: bumpCooldownUntil } = resolveBumpCooldown(
    listing.nextBumpAt,
  );

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
            {formatListingPrice(listing.price, listing.currency, listing.priceType, listing.priceUnit)}
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
          returnTo={returnTo}
        />
      )}

      {dealDialogOpen && listing.type && (
        <CloseDealDialog
          listing={{ id: listing.id, type: listing.type }}
          token={token}
          open={dealDialogOpen}
          onOpenChange={setDealDialogOpen}
          onSuccess={onAction}
        />
      )}

      {/* Actions */}
      <CardContent className="border-t px-4 pb-4 pt-3">
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
        {/* UXV.3 — el error del bump se queda AQUÍ, inline, a propósito: lleva enganchado
            el enlace para comprar créditos, o sea una acción de recuperación anclada al
            sitio (regla de reparto FEEDBACK-D2). Lo que se fue al toast es la
            CONFIRMACIÓN, que es un evento y no tiene nada que el usuario deba hacer. */}
        {bumpError && <p className="mb-2 text-xs text-destructive">{bumpError}</p>}

        <div className="flex flex-wrap gap-2">
          {/* Editar — available for DRAFT, ACTIVE, RESERVED, PAUSED (ciclo de
              vida RÁFAGA 2: nada impide editar algo solo temporalmente fuera
              del catálogo) */}
          {['DRAFT', 'ACTIVE', 'RESERVED', 'PAUSED'].includes(listing.status) && (
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

          {/* Cerrar trato — ACTIVE or RESERVED. Ramificado por tipo (ciclo de
              vida RÁFAGA 1): PRODUCTO "Marcar vendido" (se agota), SERVICIO
              "Registrar cliente" (sigue publicado, admite repetirse) — el
              copy deja claro que no se despublica. */}
          {['ACTIVE', 'RESERVED'].includes(listing.status) && listing.type && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => setDealDialogOpen(true)}
            >
              {listing.type === 'SERVICE' ? (
                <UserPlus className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
              )}
              {listing.type === 'SERVICE' ? 'Registrar cliente' : 'Marcar vendido'}
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

          {/* Pausar — ciclo de vida RÁFAGA 2: temporal, reactivable, solo ACTIVE */}
          {listing.status === 'ACTIVE' && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => runAction('pause', () => pauseListing(listing.id, token))}
            >
              {busy === 'pause' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <PauseCircle className="mr-1.5 h-3.5 w-3.5" />
              )}
              Pausar
            </Button>
          )}

          {/* Reactivar — solo PAUSED */}
          {listing.status === 'PAUSED' && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => runAction('reactivate', () => reactivateListing(listing.id, token))}
            >
              {busy === 'reactivate' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
              )}
              Reactivar
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
                    // UXV.3 — el bump era el ÚNICO sitio de la zona que ya confirmaba, y
                    // lo hacía con un <p> verde propio. Pasa al canal común: si se quedara
                    // inline mientras destacar usa toast, la incoherencia que M5 denuncia
                    // seguiría ahí, solo que del revés. El mensaje no cambia — sigue
                    // distinguiendo con cuál de las tres monedas se pagó.
                    successMessage: (result) =>
                      result.paidWith === 'PRO_QUOTA'
                        ? 'Bump aplicado. Gratis, con tu cuota mensual Pro.'
                        : result.paidWith === 'BUMP_BALANCE'
                          ? 'Bump aplicado. Gratis, de tu saldo de bumps.'
                          : `Bump aplicado. Se han descontado ${result.cost} créditos.`,
                    onSuccess: () => {
                      setBusy(null);
                      onAction();
                    },
                    onError: (err) => {
                      if (isCreditError(err)) {
                        setBumpError(
                          <>
                            No tienes créditos suficientes para hacer bump.{' '}
                            <Link href={comprarCreditosHref} className="underline hover:text-foreground">
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
                  ? bumpCooldownTitle(bumpCooldownUntil)
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
              ) : bumpPricing.bumpQuota.remaining > 0 ? (
                // Monetización ráfaga 3 — prioridad de consumo: nivel 1, se
                // gasta ANTES que el saldo de bumps y que los créditos (se
                // pierde si no se usa este periodo, a diferencia del saldo).
                <>
                  Bump gratis{' '}
                  <span className="ml-1 text-xs">
                    (cuota: te quedan {bumpPricing.bumpQuota.remaining} este mes)
                  </span>
                </>
              ) : bumpPricing.bumpBalance > 0 ? (
                // Monetización ráfaga 2 — nivel 2: si no hay cuota, el saldo de
                // bumps por cupón se gasta antes que los créditos.
                <>
                  Bump gratis{' '}
                  <span className="ml-1 text-xs">(guardado: te quedan {bumpPricing.bumpBalance})</span>
                </>
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

          {/* Archivar — ciclo de vida RÁFAGA 2: permanente, IRREVERSIBLE, alternativa
              no destructiva a Eliminar. Pide confirmación igual que Eliminar. */}
          {ARCHIVABLE_STATUSES.includes(listing.status) && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy !== null}>
                  {busy === 'archive' ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Archive className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Archivar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Archivar este anuncio?</AlertDialogTitle>
                  <AlertDialogDescription>
                    «{listing.title}» dejará de estar publicado de forma permanente. A diferencia
                    de eliminar, conserva las conversaciones, tratos y valoraciones — pero esta
                    acción no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => runAction('archive', () => archiveListing(listing.id, token))}
                  >
                    Archivar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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

          {/* Atención al usuario R6 — entrada contextual. Lleva el listingId por
              query param para que /mis-tickets/nuevo prefije la entidad enlazada.
              El id es solo una SUGERENCIA: el backend revalida que el anuncio es
              del usuario al crear el ticket (422 si no), así que manipular la URL
              no consigue nada. */}
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href={`/mis-tickets/nuevo?listingId=${listing.id}`} prefetch={false}>
              <LifeBuoy className="mr-1.5 h-3.5 w-3.5" />
              ¿Necesitas ayuda?
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
