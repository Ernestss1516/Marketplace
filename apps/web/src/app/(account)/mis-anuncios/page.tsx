import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PlusCircle, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { getMyListings } from '@/lib/api/anuncios';
import { getProStatus, getCatalog, type ProStatus, type CatalogResponse } from '@/lib/api/billing';
import { getActiveBanners } from '@/lib/api/banners';
import { MisAnunciosClient } from '@/components/anuncios/MisAnunciosClient';
import { BannerList } from '@/components/banners/BannerList';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata = { title: 'Mis anuncios' };

export default async function MisAnunciosPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/mis-anuncios'));

  const token = session.user.accessToken;

  const [{ items }, proStatus, catalog, banners] = await Promise.all([
    getMyListings(token),
    getProStatus(token).catch(
      (): ProStatus => ({ isPro: false, limit: 0, used: 0, remaining: 0 }),
    ),
    // H8 Bloque D fase 2 — catálogo público, solo para leer el coste de bump
    // (con descuento de campaña ya aplicado si lo hay). Fallback silencioso:
    // sin campaña visible es exactamente el comportamiento de hoy.
    getCatalog().catch(
      (): CatalogResponse => ({ products: [], bumpCreditCost: 5 }),
    ),
    getActiveBanners('MIS_ANUNCIOS').catch(() => []),
  ]);

  const bumpPricing = {
    bumpCreditCost: catalog.bumpCreditCost,
    bumpOriginalCreditCost: catalog.bumpOriginalCreditCost,
    bumpDiscountPercent: catalog.bumpDiscountPercent,
  };

  return (
    <div>
      {banners.length > 0 && (
        <div className="mb-6">
          <BannerList banners={banners} />
        </div>
      )}

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mis anuncios</h1>
        <div className="flex gap-2">
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
