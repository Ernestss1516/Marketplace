import { redirect } from 'next/navigation';
import Link from 'next/link';
import { BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { getMyAlerts } from '@/lib/api/alertas';
import { getActiveBanners } from '@/lib/api/banners';
import { BannerList } from '@/components/banners/BannerList';
import { MisAlertasClient } from './MisAlertasClient';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata = { title: 'Mis alertas' };

const PER_PAGE = 20;

export default async function MisAlertasPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/mis-alertas'));

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  // El `Promise.all` es NUEVO aquí: el banner no debe esperar a las alertas, que
  // es lo que pasaría con dos `await` seguidos. `getMyAlerts` sigue SIN `.catch`
  // —igual que antes, si falla la página revienta y eso no lo cambia esta
  // ráfaga—; el `.catch` es solo del banner, que nunca puede tumbar nada.
  const [data, banners] = await Promise.all([
    getMyAlerts(session.user.accessToken, page, PER_PAGE),
    getActiveBanners('MIS_ALERTAS').catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Mis alertas</h1>

      {/* Debajo del <h1> y hermano suyo dentro del `space-y-6`: sin margen propio (§3.3). */}
      {banners.length > 0 && <BannerList banners={banners} />}

      {data.total === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center text-muted-foreground">
          <BellOff className="h-12 w-12 opacity-30" />
          <p className="text-base">Aún no tienes alertas guardadas.</p>
          <Button variant="outline" asChild>
            <Link href="/busqueda">Buscar y crear una alerta</Link>
          </Button>
        </div>
      ) : (
        <MisAlertasClient
          initialItems={data.items}
          totalInitial={data.total}
          page={page}
          pages={data.pages}
        />
      )}
    </div>
  );
}
