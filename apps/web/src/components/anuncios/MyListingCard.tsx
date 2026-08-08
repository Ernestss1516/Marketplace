'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Eye, Heart, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatListingPrice } from './listing-card-shared';
import { PromocionarControl } from './owner/PromocionarControl';
import { PromotionStatus } from './owner/PromotionStatus';
import { OwnerActionsMenu } from './owner/OwnerActionsMenu';
import { useListingActions } from './owner/use-listing-actions';
import { canPromote } from './owner/promocion';
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

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
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

interface Props {
  listing: ListingSummary;
  token: string;
  onAction: () => void;
  bumpPricing: BumpPricing;
}

/**
 * UXV.4 (A6) — la tarjeta de gestión, con JERARQUÍA.
 *
 * LO QUE HABÍA: hasta doce botones `variant="outline" size="sm"` en un solo `flex-wrap`.
 * Editar, Reservar, Marcar vendido, Renovar, Pausar, Reactivar, Destacar, Bump, Archivar,
 * Eliminar y «¿Necesitas ayuda?», todos con el mismo peso: la acción que genera ingreso,
 * la gestión del ciclo de vida y la destrucción irreversible, indistinguibles. En móvil,
 * tres o cuatro filas de botones por anuncio.
 *
 * LO QUE HAY: tres niveles (TARJETA-D1).
 *   [ Promocionar ]  Editar · Ver anuncio · <la acción de estado que toca>   ⋯
 *
 * NINGUNA ACCIÓN SE HA PERDIDO — están todas, repartidas por peso. Qué va en cada nivel lo
 * decide `useListingActions`, que es la MISMA lista que consume la ficha pública: dos
 * inventarios mantenidos por separado es lo que hizo divergir las dos superficies.
 */
export function MyListingCard({ listing, token, onAction, bumpPricing }: Props) {
  const [dealDialogOpen, setDealDialogOpen] = useState(false);

  const { secundarias, menu, busy, error } = useListingActions({
    listing,
    token,
    onDone: onAction,
  });

  const location = [listing.city, listing.province].filter(Boolean).join(', ');

  /**
   * UXV.3 (A7-flujo) — si el usuario sale a comprar créditos, aquí es a dónde vuelve: la
   * FICHA de este anuncio, donde puede rematar la acción en un clic.
   */
  const returnTo = listing.status === 'ACTIVE' ? `/anuncio/${listing.slug}` : '/mis-anuncios';

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
            <Badge
              variant={STATUS_VARIANTS[listing.status] ?? 'outline'}
              className="shrink-0 text-xs"
            >
              {STATUS_LABELS[listing.status] ?? listing.status}
            </Badge>
          </div>

          <p className="text-base font-bold">
            {formatListingPrice(
              listing.price,
              listing.currency,
              listing.priceType,
              listing.priceUnit,
            )}
          </p>

          {location && <p className="text-xs text-muted-foreground">{location}</p>}

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

          {/* UXV.4 — ZONA de estado promocional (antes, una línea suelta de featuredUntil).
              Es donde entrará «Próximo bump: …» con el bump automático. */}
          <PromotionStatus
            featuredUntil={listing.featuredUntil}
            nextBumpAt={listing.nextBumpAt}
            className="mt-0.5"
          />

          {/* H8 Bloque C2 — cifras básicas: vistas + me gusta */}
          <div
            className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground"
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

      {dealDialogOpen && listing.type && (
        <CloseDealDialog
          listing={{ id: listing.id, type: listing.type }}
          token={token}
          open={dealDialogOpen}
          onOpenChange={setDealDialogOpen}
          onSuccess={onAction}
        />
      )}

      {/* Acciones */}
      <CardContent className="border-t px-4 pb-4 pt-3">
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}

        {/*
          `flex-wrap` con el menú empujado a la derecha por `ml-auto`: en escritorio es una
          sola fila; en móvil, la primaria y las secundarias saltan de línea entre ellas
          pero NUNCA son doce botones, porque las secundarias son como mucho tres y el
          resto vive en el «⋯».
        */}
        <div className="flex flex-wrap items-center gap-2">
          {canPromote(listing.status) && (
            <PromocionarControl
              listing={listing}
              token={token}
              bumpPricing={bumpPricing}
              onDone={onAction}
              returnTo={returnTo}
            />
          )}

          {secundarias.map((action) => {
            const Icon = action.icon;
            return action.href ? (
              <Button key={action.key} asChild variant="outline" size="sm">
                {/* prefetch={false}: misma mitigación que ListingCard.tsx — parrilla de
                    varias tarjetas sobre rutas dinámicas. */}
                <Link href={action.href} prefetch={false}>
                  <Icon className="mr-1.5 h-3.5 w-3.5" />
                  {action.label}
                </Link>
              </Button>
            ) : (
              <Button
                key={action.key}
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={action.run}
              >
                {busy === action.key ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Icon className="mr-1.5 h-3.5 w-3.5" />
                )}
                {action.label}
              </Button>
            );
          })}

          <div className="ml-auto">
            <OwnerActionsMenu
              actions={menu}
              onDialog={() => setDealDialogOpen(true)}
              disabled={busy !== null}
              label={`Más acciones de «${listing.title}»`}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
