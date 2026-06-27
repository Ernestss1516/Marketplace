import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Coins, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { auth } from '@/lib/auth';
import { getWallet, getCatalog, type WalletItem, type CreditLedgerType } from '@/lib/api/billing';
import { PackList } from './_components/PackList';

export const metadata: Metadata = { title: 'Mis créditos' };

const LEDGER_LABELS: Record<CreditLedgerType, string> = {
  PACK_PURCHASE: 'Compra de pack',
  FEATURED_DEBIT: 'Destacado',
  BUMP_DEBIT: 'Bump',
  ADMIN_CREDIT: 'Crédito manual',
  ADMIN_DEBIT: 'Ajuste',
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

export default async function MisCreditosPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect('/login');

  const token = session.user.accessToken;

  const [wallet, catalog] = await Promise.all([
    getWallet(token).catch(() => ({
      balance: 0,
      items: [],
      total: 0,
      page: 1,
      perPage: 20,
      totalPages: 0,
    })),
    getCatalog().catch(() => ({ products: [], bumpCreditCost: 5 })),
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
    </div>
  );
}
