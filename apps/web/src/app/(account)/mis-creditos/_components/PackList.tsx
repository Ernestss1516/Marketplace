'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Coins, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { createPackCheckout, type CatalogProduct, type RedsysFormData } from '@/lib/api/billing';
import { toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { RedsysRedirectForm } from './RedsysRedirectForm';

interface Props {
  packs: CatalogProduct[];
}

function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(amount);
}

export function PackList({ packs }: Props) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { run } = useApiAction();

  const [loadingPackId, setLoadingPackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redsysFormData, setRedsysFormData] = useState<RedsysFormData | null>(null);

  // Flatten: one card per individual credit pack price (each has its own creditPackId)
  const packItems = packs.flatMap((product) =>
    product.prices
      .filter((p) => p.creditPackId != null)
      .map((price) => ({ product, price })),
  );

  async function handleBuy(creditPackId: string) {
    if (status === 'loading') return;

    if (!session?.user.accessToken) {
      router.push('/login?callbackUrl=%2Fmis-creditos');
      return;
    }

    setLoadingPackId(creditPackId);
    setError(null);

    await run(
      () => createPackCheckout(session.user.accessToken!, creditPackId),
      {
        onSuccess: ({ redsysFormData: data }) => {
          setRedsysFormData(data);
        },
        onError: (err) => {
          setError(toUserMessage(err));
          setLoadingPackId(null);
        },
        callbackUrl: '/login?callbackUrl=%2Fmis-creditos',
      },
    );
  }

  // Once we have form data, render the auto-submitting form (user is redirected to TPV)
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
          const isLoading = loadingPackId === price.creditPackId;
          const displayName = price.packName ?? product.name;

          return (
            <Card key={price.priceId} className="flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Coins className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">{displayName}</h3>
                </div>
                {product.description && (
                  <p className="text-sm text-muted-foreground">{product.description}</p>
                )}
              </CardHeader>
              <CardContent className="flex-1">
                <p className="text-3xl font-bold text-primary">
                  {price.creditAmount}
                  <span className="ml-1 text-base font-normal text-muted-foreground">créditos</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatPrice(price.amount, price.currency)}
                </p>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  onClick={() => handleBuy(price.creditPackId!)}
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
