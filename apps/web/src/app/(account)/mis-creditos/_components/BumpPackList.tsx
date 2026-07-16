'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Zap, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { createBumpPackCheckout, type CatalogProduct, type RedsysFormData } from '@/lib/api/billing';
import { toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { RedsysRedirectForm } from './RedsysRedirectForm';

interface Props {
  packs: CatalogProduct[];
  /** Monetización ráfaga 4 — para previsualizar "+N de regalo" antes de comprar.
   * Solo una vista previa: lo que de verdad se acredita se congela en el checkout. */
  isPro: boolean;
  proExtraBumpsPercent: number;
}

function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(amount);
}

export function BumpPackList({ packs, isPro, proExtraBumpsPercent }: Props) {
  const { data: session, status } = useSession();
  const { run } = useApiAction();
  const { requireAuth, loginUrl } = useRequireAuth();

  const [loadingPackId, setLoadingPackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redsysFormData, setRedsysFormData] = useState<RedsysFormData | null>(null);

  // Flatten: one card per individual bump pack price (each has its own bumpPackId)
  const packItems = packs.flatMap((product) =>
    product.prices
      .filter((p) => p.bumpPackId != null)
      .map((price) => ({ product, price })),
  );

  async function handleBuy(bumpPackId: string) {
    if (status === 'loading') return;
    if (!requireAuth()) return;

    setLoadingPackId(bumpPackId);
    setError(null);

    await run(
      () => createBumpPackCheckout(session!.user.accessToken!, bumpPackId),
      {
        onSuccess: ({ redsysFormData: data }) => {
          setRedsysFormData(data);
        },
        onError: (err) => {
          setError(toUserMessage(err));
          setLoadingPackId(null);
        },
        callbackUrl: loginUrl,
      },
    );
  }

  if (redsysFormData) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Redirigiendo al TPV…</p>
        <RedsysRedirectForm formData={redsysFormData} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {packItems.map(({ product, price }) => {
          const isLoading = loadingPackId === price.bumpPackId;
          const displayName = price.packName ?? product.name;
          const bumpAmount = price.bumpAmount ?? 0;
          const bonusPreview = isPro ? Math.ceil((bumpAmount * proExtraBumpsPercent) / 100) : 0;

          return (
            <Card key={price.priceId} className="flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">{displayName}</h3>
                </div>
                {product.description && (
                  <p className="text-sm text-muted-foreground">{product.description}</p>
                )}
              </CardHeader>
              <CardContent className="flex-1">
                <p className="text-3xl font-bold text-primary">
                  {bumpAmount}
                  <span className="ml-1 text-base font-normal text-muted-foreground">bumps</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatPrice(price.amount, price.currency)}
                </p>
                {bonusPreview > 0 && (
                  <p className="mt-1 text-xs font-medium text-amber-600">
                    + {bonusPreview} de regalo por ser Pro
                  </p>
                )}
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  onClick={() => handleBuy(price.bumpPackId!)}
                  disabled={isLoading || loadingPackId !== null}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Procesando…
                    </>
                  ) : (
                    'Comprar'
                  )}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {error && (
        <p className="text-center text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
