import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PlusCircle, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { getMyListings } from '@/lib/api/anuncios';
import {
  getProStatus,
  getCatalog,
  getWallet,
  type ProStatus,
  type CatalogResponse,
} from '@/lib/api/billing';
import { getActiveBanners } from '@/lib/api/banners';
import { MisAnunciosClient } from '@/components/anuncios/MisAnunciosClient';
import { BannerList } from '@/components/banners/BannerList';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata = { title: 'Mis anuncios' };

export default async function MisAnunciosPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/mis-anuncios'));

  const token = session.user.accessToken;

  const [{ items }, proStatus, catalog, wallet, banners] = await Promise.all([
    getMyListings(token),
    getProStatus(token).catch(
      (): ProStatus => ({
        isPro: false,
        limit: 0,
        used: 0,
        remaining: 0,
        bumpQuota: { limit: 0, used: 0, remaining: 0 },
      }),
    ),
    // H8 Bloque D fase 2 — catálogo público, solo para leer el coste de bump
    // (con descuento de campaña ya aplicado si lo hay). Fallback silencioso:
    // sin campaña visible es exactamente el comportamiento de hoy.
    getCatalog().catch(
      (): CatalogResponse => ({ products: [], bumpCreditCost: 5, proExtraBumpsPercent: 20 }),
    ),
    // Monetización ráfaga 2 — saldo de bumps del usuario, para que el botón
    // "Bump" sepa si va a ser gratis antes de que el usuario haga clic.
    getWallet(token).catch(() => ({ balance: 0, bumpBalance: 0 })),
    getActiveBanners('MIS_ANUNCIOS').catch(() => []),
  ]);

  const bumpPricing = {
    bumpCreditCost: catalog.bumpCreditCost,
    bumpOriginalCreditCost: catalog.bumpOriginalCreditCost,
    bumpDiscountPercent: catalog.bumpDiscountPercent,
    bumpBalance: wallet.bumpBalance,
    bumpQuota: proStatus.bumpQuota,
  };

  return (
    <div>
      {banners.length > 0 && (
        <div className="mb-6">
          <BannerList banners={banners} />
        </div>
      )}

      {/* UXV.2 (A3) — `flex-wrap` + `gap-3`: en 375 px el título y los dos botones no
          caben en una fila, y sin permitir el salto empujaban el ancho del documento a
          480 px (barra de scroll horizontal en TODA la página, no solo aquí). Es la
          única pantalla de la zona que desbordaba; medido en las dieciséis. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Mis anuncios</h1>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/mis-anuncios/estadisticas">
              <BarChart3 className="mr-2 h-4 w-4" />
              Ver estadísticas
            </Link>
          </Button>
          <Button asChild>
            <Link href="/publicar">
              <PlusCircle className="mr-2 h-4 w-4" />
              Publicar anuncio
            </Link>
          </Button>
        </div>
      </div>

      <MisAnunciosClient
        initialListings={items}
        initialProStatus={proStatus}
        token={token}
        bumpPricing={bumpPricing}
      />
    </div>
  );
}
