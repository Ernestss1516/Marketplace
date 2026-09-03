'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Zap, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import {
  createBumpPackCheckout,
  type ActiveBonusCampaign,
  type CatalogProduct,
  type RedsysFormData,
} from '@/lib/api/billing';
import { toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { ProHint } from '@/components/pro/ProGate';
import { RedsysRedirectForm } from './RedsysRedirectForm';

interface Props {
  packs: CatalogProduct[];
  /** Monetización ráfaga 4 — para previsualizar "+N de regalo" antes de comprar.
   * Solo una vista previa: lo que de verdad se acredita se congela en el checkout. */
  isPro: boolean;
  proExtraBumpsPercent: number;
  /**
   * MIS-CRÉDITOS RÁFAGA A — la campaña BUMP_BONUS activa. Es OTRA campaña que la de
   * créditos (`CREDIT_BONUS`): pueden estar activas por separado, así que cada lista
   * recibe la suya y ninguna anuncia la de la otra moneda.
   */
  campaign?: ActiveBonusCampaign;
}

function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(amount);
}

export function BumpPackList({ packs, isPro, proExtraBumpsPercent, campaign }: Props) {
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

  // Mismo respaldo que en la lista de créditos: nunca «la campaña «undefined»».
  const campaignLabel = campaign?.name ? `la campaña «${campaign.name}»` : 'la campaña activa';

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
      () => createBumpPackCheckout(session!.user.accessToken!, bumpPackId, volver),
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
      {/* UXV.3 (B4) — mismo criterio que en PackList: anunciar la redirección sin
          desmontar la sección. */}
      {redsysFormData && (
        <div className="flex items-center justify-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Redirigiendo al TPV…
          <RedsysRedirectForm formData={redsysFormData} />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {packItems.map(({ product, price }) => {
          const isLoading = loadingPackId === price.bumpPackId;
          const displayName = price.packName ?? product.name;
          const bumpAmount = price.bumpAmount ?? 0;
          // E-4 — ANTES: `isPro ? Math.ceil((bumpAmount * pct) / 100) : 0`. Dos defectos en
          // una línea. El `: 0` escondía el beneficio justo a quien había que convencer, y
          // el `Math.ceil` era una SEGUNDA copia de la fórmula que congela el checkout: dos
          // sitios que pueden separarse y prometer un número distinto del que se acredita.
          // Ahora el número lo da el servidor, y es el mismo para los dos.
          const bonus = price.proBonusAmount ?? 0;
          // MIS-CRÉDITOS RÁFAGA A — el regalo de la campaña BUMP_BONUS, con el mismo
          // origen que el de arriba: resuelto por el catálogo con la función que congela
          // el checkout. Aquí no se calcula nada.
          const campaignBonus = price.campaignBonusAmount ?? 0;
          // Suma, no fórmula — espejo de la lista de créditos y de lo que hace el processor
          // al acreditar (`bumpAmount + bonusBumpAmount + campaignBonusBumpAmount`).
          const total = bumpAmount + (isPro ? bonus : 0) + campaignBonus;

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
                {/* Simétrico con los packs de créditos: mismo reparto, mismo origen del
                    número. Antes esta lista lo hacía a medias y la de créditos, nada.

                    MIS-CRÉDITOS RÁFAGA A — y la simetría se mantiene también aquí: mismas
                    cuatro líneas independientes, mismos `data-testid`, misma condición para
                    el total. La asimetría entre las dos monedas era del código, no del
                    producto; que la campaña se viera en una y no en la otra la habría
                    reabierto. */}
                {campaignBonus > 0 && (
                  <p className="mt-2 border-t pt-2 text-sm font-semibold" data-testid="pack-total">
                    Recibes {total} bumps
                  </p>
                )}
                {bonus > 0 && isPro && (
                  <p className="mt-1 text-xs font-medium text-warning-foreground" data-testid="pack-bonus-pro">
                    + {bonus} de regalo por ser Pro
                  </p>
                )}
                {campaignBonus > 0 && (
                  <p className="mt-1 text-xs font-medium text-success-foreground" data-testid="pack-bonus-campana">
                    + {campaignBonus} por {campaignLabel}
                  </p>
                )}
                {bonus > 0 && !isPro && (
                  <div className="mt-1">
                    <ProHint testId="pack-bonus-hint">
                      Con Pro te llevarías {bonus} bumps más (+{proExtraBumpsPercent}%).
                    </ProHint>
                  </div>
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
