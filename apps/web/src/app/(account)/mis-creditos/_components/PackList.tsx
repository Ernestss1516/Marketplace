'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Coins, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { createPackCheckout, type CatalogProduct, type RedsysFormData } from '@/lib/api/billing';
import { toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { ProHint } from '@/components/pro/ProGate';
import { RedsysRedirectForm } from './RedsysRedirectForm';

interface Props {
  packs: CatalogProduct[];
  /**
   * E-5 — esta lista no recibía NADA sobre Pro, así que el bonus de créditos no se
   * previsualizaba para nadie: ni el Pro veía su +20% antes de pagar, ni el no-Pro sabía
   * que existía. Se aplicaba al cobrar y se descubría después.
   */
  isPro: boolean;
  /** Para contarle al no-Pro cuánto se pierde en porcentaje, no sólo en unidades. */
  proExtraCreditsPercent?: number;
}

function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(amount);
}

export function PackList({ packs, isPro, proExtraCreditsPercent }: Props) {
  const { data: session, status } = useSession();
  const { run } = useApiAction();
  const { requireAuth, loginUrl } = useRequireAuth();
  // UXV.3 (A7-flujo) — la intención con la que el usuario llegó a la cartera, puesta en
  // la URL por quien le trajo (la tarjeta o el diálogo de destacar). Viaja al backend,
  // que la valida y la cuelga de la URL de vuelta del TPV: es la única forma de que
  // sobreviva al salto a Redsys.
  const volver = useSearchParams().get('volver') ?? undefined;

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
    if (!requireAuth()) return;

    setLoadingPackId(creditPackId);
    setError(null);

    await run(
      () => createPackCheckout(session!.user.accessToken!, creditPackId, volver),
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

  return (
    <div className="space-y-4">
      {/* UXV.3 (B4) — el aviso de redirección va ENCIMA de los packs, no EN LUGAR de
          ellos. Antes esta rama hacía `return` y sustituía la sección entera por un
          spinner: media página se quedaba en blanco mientras el resto seguía ahí, y el
          usuario perdía de vista lo que acababa de comprar justo en el instante de pagar.
          El formulario se autoenvía igual — lo único que cambia es que la página no se
          desarma debajo. */}
      {redsysFormData && (
        <div className="flex items-center justify-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Redirigiendo al TPV…
          <RedsysRedirectForm formData={redsysFormData} />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {packItems.map(({ product, price }) => {
          const isLoading = loadingPackId === price.creditPackId;
          const displayName = price.packName ?? product.name;
          // Ya calculado por el servidor. No se recalcula aquí: repetir la fórmula es cómo
          // se llega a prometer un número y acreditar otro.
          const bonus = price.proBonusAmount ?? 0;

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

                {/*
                  E-5 — EL REGALO, ANTES DE PAGAR Y PARA LOS DOS.
                  El número sale del servidor (`proBonusAmount`), que lo calcula con la
                  MISMA función que congela el checkout: lo que se enseña aquí es
                  exactamente lo que se va a acreditar, no una estimación paralela.
                */}
                {bonus > 0 &&
                  (isPro ? (
                    <p className="mt-1 text-xs font-medium text-amber-600" data-testid="pack-bonus-pro">
                      + {bonus} de regalo por ser Pro
                    </p>
                  ) : (
                    // El gate que convierte: no se le esconde el beneficio a quien hay que
                    // convencer. No bloquea la compra — la acompaña.
                    <div className="mt-1">
                      <ProHint testId="pack-bonus-hint">
                        Con Pro te llevarías {bonus} créditos más
                        {proExtraCreditsPercent ? ` (+${proExtraCreditsPercent}%)` : ''}.
                      </ProHint>
                    </div>
                  ))}
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
