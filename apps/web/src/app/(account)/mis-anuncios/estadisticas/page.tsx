import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getMyListings } from '@/lib/api/anuncios';
import { getProStatus, type ProStatus } from '@/lib/api/billing';
import { EstadisticasClient } from '@/components/anuncios/EstadisticasClient';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata = { title: 'Estadísticas de mis anuncios' };

export default async function EstadisticasPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/mis-anuncios/estadisticas'));

  const token = session.user.accessToken;

  const [{ items }, proStatus] = await Promise.all([
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
  ]);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Estadísticas de mis anuncios</h1>
      <EstadisticasClient listings={items} proStatus={proStatus} token={token} />
    </div>
  );
}
