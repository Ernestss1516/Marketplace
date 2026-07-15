'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Ticket } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError, isListingRequiredError, toCouponMessage } from '@/lib/api/client';
import { redeemCoupon } from '@/lib/api/coupons';
import { getMyListings } from '@/lib/api/anuncios';
import type { ListingSummary } from '@/types';

interface Props {
  token: string;
}

/**
 * H8 Bloque D fase 3b — flujo de dos pasos aprobado en el mini-diseño: se
 * intenta canjear solo con el código; si el cupón es de destacado, el backend
 * responde 400 LISTING_REQUIRED y AQUÍ se muestra el selector de anuncios
 * (nunca se hace una llamada previa de "vista previa" del cupón — evita una
 * superficie nueva de "probar códigos").
 */
export function RedeemCouponForm({ token }: Props) {
  const router = useRouter();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [needsListing, setNeedsListing] = useState(false);
  const [listings, setListings] = useState<ListingSummary[]>([]);
  const [selectedListingId, setSelectedListingId] = useState<string>('');
  const [loadingListings, setLoadingListings] = useState(false);

  function successMessage(result: {
    rewardType: string;
    creditAmount: number | null;
    featuredDurationDays: number | null;
    bumpAmount: number | null;
  }) {
    if (result.rewardType === 'CREDITS') {
      return `¡+${result.creditAmount} créditos añadidos!`;
    }
    if (result.rewardType === 'BUMP') {
      return `¡+${result.bumpAmount} bumps gratis añadidos a tu saldo!`;
    }
    return `¡Anuncio destacado ${result.featuredDurationDays} días!`;
  }

  async function handleSubmit(listingId?: string) {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await redeemCoupon(token, { code, ...(listingId && { listingId }) });
      setSuccess(successMessage(result));
      setNeedsListing(false);
      setCode('');
      router.refresh();
    } catch (err) {
      if (isListingRequiredError(err)) {
        setNeedsListing(true);
        setLoadingListings(true);
        try {
          const { items } = await getMyListings(token, { status: 'ACTIVE' });
          setListings(items);
        } catch {
          setError('No se pudieron cargar tus anuncios. Inténtalo de nuevo.');
          setNeedsListing(false);
        } finally {
          setLoadingListings(false);
        }
      } else {
        setError(err instanceof ApiError ? toCouponMessage(err) : 'Error al canjear el cupón.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Ticket className="h-5 w-5 text-primary" />
          ¿Tienes un código?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {success ? (
          <p className="text-sm font-medium text-green-600" data-testid="coupon-success">
            {success}
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Introduce tu código"
                disabled={busy || needsListing}
                data-testid="coupon-code-input"
              />
              {!needsListing && (
                <Button
                  onClick={() => handleSubmit()}
                  disabled={busy || !code.trim()}
                  data-testid="coupon-redeem-button"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Canjear'}
                </Button>
              )}
            </div>

            {needsListing && (
              <div className="space-y-2 rounded-md border p-3">
                <Label htmlFor="coupon-listing-select">
                  Este cupón destaca un anuncio — elige cuál:
                </Label>
                {loadingListings ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : listings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No tienes anuncios activos para destacar.
                  </p>
                ) : (
                  <>
                    <Select value={selectedListingId} onValueChange={setSelectedListingId}>
                      <SelectTrigger id="coupon-listing-select" data-testid="coupon-listing-select">
                        <SelectValue placeholder="Selecciona un anuncio…" />
                      </SelectTrigger>
                      <SelectContent>
                        {listings.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleSubmit(selectedListingId)}
                        disabled={busy || !selectedListingId}
                        data-testid="coupon-confirm-listing-button"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setNeedsListing(false);
                          setSelectedListingId('');
                        }}
                        disabled={busy}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive" data-testid="coupon-error">
                {error}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
