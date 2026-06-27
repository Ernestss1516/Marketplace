'use client';

import { useState, useEffect } from 'react';
import React from 'react';
import Link from 'next/link';
import { Loader2, Star, CreditCard, Coins } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { useApiAction } from '@/lib/api/use-api-action';
import { toUserMessage, isCreditError, toFeaturedByCreditsMessage } from '@/lib/api/client';
import {
  getCatalog,
  getWallet,
  featuredByCredits,
  createFeaturedCheckout,
  type CatalogPrice,
  type RedsysFormData,
} from '@/lib/api/billing';
import { RedsysRedirectForm } from '@/app/(account)/mis-creditos/_components/RedsysRedirectForm';
interface Props {
  listing: { id: string };
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type PayMethod = 'credits' | 'card';

export function DestacadoDialog({ listing, token, open, onOpenChange, onSuccess }: Props) {
  const { run } = useApiAction();

  const [featuredPrices, setFeaturedPrices] = useState<CatalogPrice[]>([]);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<React.ReactNode | null>(null);
  const [busy, setBusy] = useState(false);

  const [selectedPriceId, setSelectedPriceId] = useState<string>('');
  const [payMethod, setPayMethod] = useState<PayMethod>('credits');
  const [redsysFormData, setRedsysFormData] = useState<RedsysFormData | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setRedsysFormData(null);

    Promise.all([
      getCatalog().catch(() => ({ products: [], bumpCreditCost: 5 })),
      getWallet(token).catch(() => null),
    ]).then(([catalog, wallet]) => {
      const prices = catalog.products
        .flatMap((p) => p.prices)
        .filter((pr): pr is CatalogPrice => pr.durationDays != null && pr.creditAmount == null)
        .sort((a, b) => (a.durationDays ?? 0) - (b.durationDays ?? 0));

      setFeaturedPrices(prices);
      setWalletBalance(wallet?.balance ?? 0);
      if (prices.length > 0) setSelectedPriceId(prices[0].priceId);
      setLoading(false);
    });
  }, [open, token]);

  const selectedPrice = featuredPrices.find((p) => p.priceId === selectedPriceId);
  const creditCost = selectedPrice?.creditCost ?? 0;
  const canPayByCredits = walletBalance >= creditCost;

  async function handleSubmit() {
    if (!selectedPrice) return;
    setBusy(true);
    setError(null);

    if (payMethod === 'credits') {
      await run(
        () => featuredByCredits(token, selectedPrice.priceId, listing.id),
        {
          onSuccess: () => {
            onOpenChange(false);
            onSuccess();
          },
          onError: (err) => {
            if (isCreditError(err)) {
              setError(
                <>
                  No tienes créditos suficientes.{' '}
                  <Link href="/mis-creditos" className="underline hover:text-foreground">
                    Comprar créditos
                  </Link>
                </>,
              );
            } else {
              setError(toFeaturedByCreditsMessage(err));
            }
          },
          callbackUrl: '/login',
        },
      );
    } else {
      await run(
        () => createFeaturedCheckout(token, selectedPrice.priceId, listing.id),
        {
          onSuccess: (result) => {
            const { redsysFormData: data } = result as { redsysFormData: RedsysFormData };
            setRedsysFormData(data);
          },
          onError: (err) => setError(toFeaturedByCreditsMessage(err)),
          callbackUrl: '/login',
        },
      );
    }

    setBusy(false);
  }

  if (redsysFormData) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Redirigiendo al TPV…</p>
            <RedsysRedirectForm formData={redsysFormData} />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Destacar anuncio</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : featuredPrices.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No hay opciones de destacado disponibles.
          </p>
        ) : (
          <div className="space-y-6">
            <div>
              <p className="mb-3 text-sm font-medium">Duración</p>
              <RadioGroup
                value={selectedPriceId}
                onValueChange={setSelectedPriceId}
                className="space-y-2"
              >
                {featuredPrices.map((pr) => {
                  const eurFormatted = new Intl.NumberFormat('es-ES', {
                    style: 'currency',
                    currency: pr.currency,
                  }).format(pr.amount);
                  return (
                    <div
                      key={pr.priceId}
                      className="flex items-center space-x-3 rounded-md border p-3 has-[button[data-state=checked]]:border-primary"
                    >
                      <RadioGroupItem value={pr.priceId} id={`dur-${pr.priceId}`} />
                      <Label
                        htmlFor={`dur-${pr.priceId}`}
                        className="flex flex-1 cursor-pointer items-center justify-between"
                      >
                        <span>{pr.durationDays} días</span>
                        <span className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Coins className="h-3.5 w-3.5" />
                            {pr.creditCost ?? '—'} cr.
                          </span>
                          <span className="text-xs">o</span>
                          <span className="flex items-center gap-1">
                            <CreditCard className="h-3.5 w-3.5" />
                            {eurFormatted}
                          </span>
                        </span>
                      </Label>
                    </div>
                  );
                })}
              </RadioGroup>
            </div>

            <Separator />

            <div>
              <p className="mb-3 text-sm font-medium">Método de pago</p>
              <RadioGroup
                value={payMethod}
                onValueChange={(v) => setPayMethod(v as PayMethod)}
                className="space-y-2"
              >
                <div className="flex items-center space-x-3 rounded-md border p-3 has-[button[data-state=checked]]:border-primary">
                  <RadioGroupItem value="credits" id="pay-credits" />
                  <Label
                    htmlFor="pay-credits"
                    className="flex flex-1 cursor-pointer items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <Coins className="h-4 w-4 text-muted-foreground" />
                      Créditos
                    </span>
                    <span
                      className={`text-sm ${
                        canPayByCredits ? 'text-muted-foreground' : 'text-destructive'
                      }`}
                    >
                      Saldo: {walletBalance} cr.
                    </span>
                  </Label>
                </div>

                <div className="flex items-center space-x-3 rounded-md border p-3 has-[button[data-state=checked]]:border-primary">
                  <RadioGroupItem value="card" id="pay-card" />
                  <Label
                    htmlFor="pay-card"
                    className="flex flex-1 cursor-pointer items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                      Tarjeta bancaria
                    </span>
                    {selectedPrice && (
                      <span className="text-sm text-muted-foreground">
                        {new Intl.NumberFormat('es-ES', {
                          style: 'currency',
                          currency: selectedPrice.currency,
                        }).format(selectedPrice.amount)}
                      </span>
                    )}
                  </Label>
                </div>
              </RadioGroup>

              {payMethod === 'credits' && !canPayByCredits && creditCost > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Necesitas {creditCost - walletBalance} créditos más.{' '}
                  <Link href="/mis-creditos" className="underline hover:text-foreground">
                    Comprar créditos
                  </Link>
                </p>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              busy ||
              loading ||
              !selectedPriceId ||
              (payMethod === 'credits' && !canPayByCredits)
            }
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Star className="mr-2 h-4 w-4" />
            )}
            {payMethod === 'credits' ? 'Destacar con créditos' : 'Pagar con tarjeta'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
