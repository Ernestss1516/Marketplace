import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Coins, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/auth';
import {
  getWallet,
  getCatalog,
  getBumpLedger,
  getProStatus,
  type ProStatus,
} from '@/lib/api/billing';
import { PackList } from './_components/PackList';
import { BumpPackList } from './_components/BumpPackList';
import { RedeemCouponForm } from './_components/RedeemCouponForm';
import { HistorialCreditos, HistorialBumps } from './_components/Historiales';
import { buildLoginUrl } from '@/lib/auth/callback-url';

/**
 * Monetización ráfaga 4 — el título pasa a algo más general: la página cubre DOS monedas
 * (créditos y bumps), no solo una.
 *
 * UXV.6 (B1) — el monedero tenía tres nombres: «Mis créditos» en el menú, «Mi saldo» en el
 * título y `/mis-creditos` en la URL. Los dos VISIBLES ya se unificaron en UXV.2 (el menú
 * pasó a «Mi saldo», que es lo que dicen también el `<title>` y el `<h1>`).
 *
 * LA URL SE QUEDA, y es una decisión, no un olvido: renombrarla rompería los enlaces que
 * ya existen —los correos de compra, los tickets de soporte con la ruta escrita, cualquier
 * marcador del usuario— y obligaría a mantener un redirect permanente, todo a cambio de
 * una coherencia que el usuario no ve. El nombre visible es lo que se lee; la ruta es
 * historia.
 */
export const metadata: Metadata = { title: 'Mi saldo' };

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
            <h3 id="comprar" className="mb-4 text-lg font-semibold">Comprar créditos</h3>
            <PackList packs={packProducts} />
          </div>
        )}

        <div>
          <h3 className="mb-4 text-lg font-semibold">Historial de créditos</h3>
          {/* UXV.6 (M9) — paginado: la API devolvía `totalPages` desde el principio y esta
              pantalla pintaba solo los veinte primeros, sin decir que había más. */}
          <HistorialCreditos
            token={token}
            inicial={{
              items: wallet.items,
              total: wallet.total,
              page: wallet.page,
              perPage: wallet.perPage,
              totalPages: wallet.totalPages,
            }}
          />
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

        {/*
          Historial de bumps, lista separada (decisión de diseño: no fusionar dos ledgers
          paginados de modelos distintos — ver diseno-facturacion.md §17).

          UXV.6 (B5) — se muestra SIEMPRE, también vacío. Antes la sección entera
          desaparecía cuando no había movimientos, «para no añadir ruido»: el efecto real
          era que quien nunca había tenido bumps no llegaba a enterarse de que existían.
          Y UXV.6 (M9) — paginado, igual que el de créditos.
        */}
        <div>
          <h3 className="mb-4 text-lg font-semibold">Historial de bumps</h3>
          <HistorialBumps
            token={token}
            inicial={{
              items: bumpLedger.items,
              total: bumpLedger.total,
              page: bumpLedger.page,
              perPage: bumpLedger.perPage,
              totalPages: bumpLedger.totalPages,
            }}
          />
        </div>
      </section>
    </div>
  );
}
