import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Coins, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { auth } from '@/lib/auth';
import {
  getWallet,
  getCatalog,
  getBumpLedger,
  getProStatus,
  type WalletItem,
  type CreditLedgerType,
  type BumpLedgerItem,
  type BumpLedgerType,
  type ProStatus,
} from '@/lib/api/billing';
import { PackList } from './_components/PackList';
import { BumpPackList } from './_components/BumpPackList';
import { RedeemCouponForm } from './_components/RedeemCouponForm';
import { buildLoginUrl } from '@/lib/auth/callback-url';

// Monetización ráfaga 4 — la URL se queda /mis-creditos (histórica), pero el
// título pasa a algo más general: la página ahora cubre dos monedas
// (créditos y bumps), no solo una. Cosmético, no afecta a rutas ni lógica.
export const metadata: Metadata = { title: 'Mi saldo' };

const LEDGER_LABELS: Record<CreditLedgerType, string> = {
  PACK_PURCHASE: 'Compra de pack',
  FEATURED_DEBIT: 'Destacado',
  BUMP_DEBIT: 'Bump',
  ADMIN_CREDIT: 'Crédito manual',
  ADMIN_DEBIT: 'Ajuste',
  PRO_BONUS: 'Bonus Pro',
  CAMPAIGN_BONUS: 'Bonus campaña',
  COUPON_REDEEM: 'Cupón canjeado',
};

/** Monetización ráfaga 2/4 — etiquetas del historial de bumps (moneda separada). */
const BUMP_LEDGER_LABELS: Record<BumpLedgerType, string> = {
  COUPON_REDEEM: 'Cupón canjeado',
  BUMP_DEBIT: 'Bump',
  ADMIN_CREDIT: 'Crédito manual',
  ADMIN_DEBIT: 'Ajuste',
  PACK_PURCHASE: 'Compra de pack',
  PRO_BONUS: 'Bonus Pro',
};

function LedgerRow({ item }: { item: WalletItem }) {
  const isCredit = item.amount > 0;
  const label = LEDGER_LABELS[item.type] ?? item.type;
  const date = new Date(item.createdAt).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3">
        {isCredit ? (
          <TrendingUp className="h-4 w-4 shrink-0 text-green-600" />
        ) : (
          <TrendingDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{date}</p>
        </div>
      </div>
      <span
        className={`text-sm font-semibold tabular-nums ${
          isCredit ? 'text-green-600' : 'text-foreground'
        }`}
      >
        {isCredit ? '+' : ''}{item.amount} cr.
      </span>
    </div>
  );
}

/** Monetización ráfaga 2 — fila del historial de bumps. Mismo look que LedgerRow,
 * lista separada (ver diseno-facturacion.md §17: decisión explícita, no fusionar
 * dos ledgers paginados de modelos distintos por ahora). */
function BumpLedgerRow({ item }: { item: BumpLedgerItem }) {
  const isCredit = item.amount > 0;
  const label = BUMP_LEDGER_LABELS[item.type] ?? item.type;
  const date = new Date(item.createdAt).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3">
        {isCredit ? (
          <TrendingUp className="h-4 w-4 shrink-0 text-green-600" />
        ) : (
          <TrendingDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{date}</p>
        </div>
      </div>
      <span
        className={`text-sm font-semibold tabular-nums ${
          isCredit ? 'text-green-600' : 'text-foreground'
        }`}
      >
        {isCredit ? '+' : ''}{item.amount} bump{Math.abs(item.amount) === 1 ? '' : 's'}
      </span>
    </div>
  );
}

export default async function MisCreditosPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/mis-creditos'));

  const token = session.user.accessToken;

  const [wallet, catalog, bumpLedger, proStatus] = await Promise.all([
    getWallet(token).catch(() => ({
      balance: 0,
      bumpBalance: 0,
      items: [],
      total: 0,
      page: 1,
      perPage: 20,
      totalPages: 0,
    })),
    getCatalog().catch(() => ({ products: [], bumpCreditCost: 5, proExtraBumpsPercent: 20 })),
    // Monetización ráfaga 2 — historial de bumps, lista separada de créditos.
    getBumpLedger(token).catch(() => ({
      bumpBalance: 0,
      items: [],
      total: 0,
      page: 1,
      perPage: 20,
      totalPages: 0,
    })),
    // Monetización ráfaga 4 — solo para saber isPro y previsualizar el bonus
    // de packs de bumps antes de comprar.
    getProStatus(token).catch(
      (): ProStatus => ({
        isPro: false,
        limit: 0,
        used: 0,
        remaining: 0,
        bumpQuota: { limit: 0, used: 0, remaining: 0 },
      }),
    ),
  ]);

  const packProducts = catalog.products.filter(
    (p) => p.type === 'ONE_TIME' && p.prices.some((pr) => pr.creditAmount != null),
  );
  // Monetización ráfaga 4 — packs de bumps DIRECTOS, separados de los de créditos.
  const bumpPackProducts = catalog.products.filter(
    (p) => p.type === 'ONE_TIME' && p.prices.some((pr) => pr.bumpAmount != null),
  );

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold">Mi saldo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Créditos y bumps son monedas distintas: los créditos sirven para destacar anuncios o
          hacer bump; los bumps solo sirven para bumpear, y se gastan primero al hacerlo.
        </p>
      </div>

      {/* Canjear cupón — válido para cualquiera de las dos monedas según el tipo de cupón */}
      <RedeemCouponForm token={token} />

      {/* ── Créditos ────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-xl font-bold">Créditos</h2>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-5 w-5 text-primary" />
              Saldo disponible
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">
              {wallet.balance}
              <span className="ml-2 text-lg font-normal text-muted-foreground">créditos</span>
            </p>
          </CardContent>
        </Card>

        {packProducts.length > 0 && (
          <div>
            <h3 className="mb-4 text-lg font-semibold">Comprar créditos</h3>
            <PackList packs={packProducts} />
          </div>
        )}

        <div>
          <h3 className="mb-4 text-lg font-semibold">Historial de créditos</h3>
          {wallet.items.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No hay movimientos todavía. Compra un pack para empezar.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-4">
                {wallet.items.map((item, idx) => (
                  <div key={item.id}>
                    <LedgerRow item={item} />
                    {idx < wallet.items.length - 1 && <Separator />}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* ── Bumps ───────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-xl font-bold">Bumps</h2>

        {/* Monetización ráfaga 2 — saldo de bumps SIEMPRE visible, aunque sea 0:
            ocultarlo escondería que la función existe a quien nunca compró ni
            canjeó un cupón de bumps. */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-5 w-5 text-primary" />
              Saldo de bumps
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">
              {wallet.bumpBalance}
              <span className="ml-2 text-lg font-normal text-muted-foreground">
                bump{wallet.bumpBalance === 1 ? '' : 's'} gratis
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              No caducan. Al bumpear se gastan antes que los créditos (y, si eres Pro, después de
              tu cuota mensual gratis).
            </p>
          </CardContent>
        </Card>

        {/* Monetización ráfaga 4 — packs de bumps directos, opción B retirada
            (ya no son créditos con highlightBumps). */}
        {bumpPackProducts.length > 0 && (
          <div>
            <h3 className="mb-4 text-lg font-semibold">Comprar bumps</h3>
            <BumpPackList
              packs={bumpPackProducts}
              isPro={proStatus.isPro}
              proExtraBumpsPercent={catalog.proExtraBumpsPercent}
            />
          </div>
        )}

        {/* Historial de bumps, lista separada (ver comentario de diseño en
            BumpLedgerRow). Solo se muestra si hay algo que mostrar, para no
            añadir ruido a quien nunca ha tenido bumps. */}
        {bumpLedger.items.length > 0 && (
          <div>
            <h3 className="mb-4 text-lg font-semibold">Historial de bumps</h3>
            <Card>
              <CardContent className="pt-4">
                {bumpLedger.items.map((item, idx) => (
                  <div key={item.id}>
                    <BumpLedgerRow item={item} />
                    {idx < bumpLedger.items.length - 1 && <Separator />}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </section>
    </div>
  );
}
