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
  type WalletItem,
  type CreditLedgerType,
  type BumpLedgerItem,
  type BumpLedgerType,
} from '@/lib/api/billing';
import { PackList } from './_components/PackList';
import { RedeemCouponForm } from './_components/RedeemCouponForm';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata: Metadata = { title: 'Mis créditos' };

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

/** Monetización ráfaga 2 — etiquetas del historial de bumps (moneda separada). */
const BUMP_LEDGER_LABELS: Record<BumpLedgerType, string> = {
  COUPON_REDEEM: 'Cupón canjeado',
  BUMP_DEBIT: 'Bump',
  ADMIN_CREDIT: 'Crédito manual',
  ADMIN_DEBIT: 'Ajuste',
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

  const [wallet, catalog, bumpLedger] = await Promise.all([
    getWallet(token).catch(() => ({
      balance: 0,
      bumpBalance: 0,
      items: [],
      total: 0,
      page: 1,
      perPage: 20,
      totalPages: 0,
    })),
    getCatalog().catch(() => ({ products: [], bumpCreditCost: 5 })),
    // Monetización ráfaga 2 — historial de bumps, lista separada de créditos.
    getBumpLedger(token).catch(() => ({
      bumpBalance: 0,
      items: [],
      total: 0,
      page: 1,
      perPage: 20,
      totalPages: 0,
    })),
  ]);

  const packProducts = catalog.products.filter(
    (p) => p.type === 'ONE_TIME' && p.prices.some((pr) => pr.creditAmount != null),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Mis créditos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Usa tus créditos para destacar anuncios o hacer bump.
        </p>
      </div>

      {/* Saldo */}
      <div className="grid gap-4 sm:grid-cols-2">
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

        {/* Monetización ráfaga 2 — saldo de bumps SIEMPRE visible, aunque sea 0:
            ocultarlo escondería que la función existe a quien nunca canjeó un cupón. */}
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
              No caducan. Se gastan antes que los créditos al bumpear.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Canjear cupón */}
      <RedeemCouponForm token={token} />

      {/* Compra de packs */}
      {packProducts.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Comprar créditos</h2>
          <PackList packs={packProducts} />
        </section>
      )}

      {/* Historial */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Historial de movimientos</h2>
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
      </section>

      {/* Monetización ráfaga 2 — historial de bumps, lista separada (ver
          comentario de diseño en BumpLedgerRow). Solo se muestra si hay algo
          que mostrar, para no añadir ruido a quien nunca ha tenido bumps. */}
      {bumpLedger.items.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Historial de bumps</h2>
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
        </section>
      )}
    </div>
  );
}
