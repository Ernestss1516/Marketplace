'use client';

import { useState } from 'react';
import React from 'react';
import Link from 'next/link';
import { ChevronDown, Loader2, Megaphone, Star, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { bumpListing } from '@/lib/api/billing';
import { isCreditError, isCooldownError, formatRetryAfter, toBumpMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { bumpCooldownTitle } from '@/lib/bump-cooldown';
import { PromocionarDialog } from './PromocionarDialog';
import { bumpCostLabel, promocionarLabel, resolveBumpOffer } from './promocion';
import type { BumpPricing, ListingSummary } from '@/types';

/**
 * UXV.4 — el control PRIMARIO de la tarjeta y de la ficha (TARJETA-D1: promocionar es lo
 * que monetiza y lo que el vendedor repite, así que es lo que tiene peso visual).
 *
 * TARJETA-D2, con su matiz: el bump y el destacado se fusionan en un punto de entrada,
 * **pero el bump GRATIS sigue a un clic**. Cuando el usuario tiene cuota Pro o saldo de
 * bumps no hay nada que elegir ni que cobrar, así que meterlo detrás de un diálogo sería
 * cobrarle un paso por nada. En ese caso el control es un botón partido:
 *
 *     [ Subir gratis │ ▾ ]      ▾ → «Destacar anuncio…» (y, más adelante, «Programar»)
 *
 * y cuando el bump cuesta o está en cooldown, un botón único «Promocionar» que abre el
 * diálogo, donde los dos productos están con su precio.
 *
 * EL SITIO DEL BUMP AUTOMÁTICO (proyecto 2) ES ESE MENÚ ▾. Está ahí precisamente para que
 * «Programar bumps…» sea una entrada más, junto a «Destacar anuncio…», sin volver a tocar
 * la jerarquía de la tarjeta. No se implementa nada de eso aquí.
 */

interface Props {
  listing: Pick<ListingSummary, 'id' | 'status'> & { nextBumpAt?: string | null };
  token: string;
  bumpPricing: BumpPricing;
  onDone: () => void;
  /** UXV.3 (A7-flujo) — a dónde volver si sale a comprar créditos. */
  returnTo?: string;
  /** `card` = fila de la tarjeta; `ficha` = columna de la ficha pública (ancho completo). */
  contexto?: 'card' | 'ficha';
}

export function PromocionarControl({
  listing,
  token,
  bumpPricing,
  onDone,
  returnTo,
  contexto = 'card',
}: Props) {
  const { run } = useApiAction();
  const { loginUrl } = useRequireAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [productoInicial, setProductoInicial] = useState<'bump' | 'destacado'>('bump');

  const offer = resolveBumpOffer(bumpPricing, listing.nextBumpAt);
  const unClic = offer.free && !offer.onCooldown;
  const anchoCompleto = contexto === 'ficha';

  const comprarCreditosHref = returnTo
    ? `/mis-creditos?volver=${encodeURIComponent(returnTo)}`
    : '/mis-creditos';

  async function bumpDirecto() {
    setBusy(true);
    setError(null);
    await run(() => bumpListing(token, listing.id), {
      // UXV.3 — el canal común. Mismo mensaje que el bump lanzado desde el diálogo.
      successMessage: (result) =>
        result.paidWith === 'PRO_QUOTA'
          ? 'Bump aplicado. Gratis, con tu cuota mensual Pro.'
          : result.paidWith === 'BUMP_BALANCE'
            ? 'Bump aplicado. Gratis, de tu saldo de bumps.'
            : `Bump aplicado. Se han descontado ${result.cost} créditos.`,
      onSuccess: () => onDone(),
      onError: (err) => {
        // El error con acción de recuperación se queda inline (regla FEEDBACK-D2).
        if (isCreditError(err)) {
          setError(
            <>
              No tienes créditos suficientes para hacer bump.{' '}
              <Link href={comprarCreditosHref} className="underline hover:text-foreground">
                Comprar créditos
              </Link>
            </>,
          );
        } else if (isCooldownError(err)) {
          setError(`Ya has subido este anuncio, espera ${formatRetryAfter(err.retryAfter)}.`);
        } else {
          setError(toBumpMessage(err));
        }
      },
      callbackUrl: loginUrl,
    });
    setBusy(false);
  }

  function abrirDialogo(producto: 'bump' | 'destacado') {
    setProductoInicial(producto);
    setDialogOpen(true);
  }

  return (
    <div className={anchoCompleto ? 'space-y-2' : 'contents'}>
      {unClic ? (
        <div className={`flex ${anchoCompleto ? 'w-full' : ''}`}>
          <Button
            size="sm"
            className={`rounded-r-none ${anchoCompleto ? 'flex-1 justify-start' : ''}`}
            disabled={busy}
            onClick={bumpDirecto}
            title={bumpCostLabel(bumpPricing, offer)}
            data-testid="btn-promocionar"
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <TrendingUp className="mr-1.5 h-3.5 w-3.5" />
            )}
            {promocionarLabel(offer)}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                className="rounded-l-none border-l border-l-primary-foreground/25 px-2"
                disabled={busy}
                aria-label="Más opciones de promoción"
                data-testid="btn-promocionar-mas"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => abrirDialogo('destacado')}>
                <Star className="mr-2 h-4 w-4" />
                Destacar anuncio…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => abrirDialogo('bump')}>
                <Megaphone className="mr-2 h-4 w-4" />
                Ver todas las opciones…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <Button
          size="sm"
          className={anchoCompleto ? 'w-full justify-start' : ''}
          onClick={() => abrirDialogo(offer.onCooldown ? 'destacado' : 'bump')}
          title={
            offer.onCooldown && offer.until
              ? `Subir al inicio: ${bumpCooldownTitle(offer.until)}`
              : bumpCostLabel(bumpPricing, offer)
          }
          data-testid="btn-promocionar"
        >
          <Megaphone className="mr-1.5 h-3.5 w-3.5" />
          {promocionarLabel(offer)}
        </Button>
      )}

      {error && (
        <p className={`text-xs text-destructive ${anchoCompleto ? '' : 'basis-full'}`}>{error}</p>
      )}

      {dialogOpen && (
        <PromocionarDialog
          listing={{ id: listing.id }}
          token={token}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSuccess={onDone}
          bumpPricing={bumpPricing}
          nextBumpAt={listing.nextBumpAt}
          productoInicial={productoInicial}
          returnTo={returnTo}
        />
      )}
    </div>
  );
}
