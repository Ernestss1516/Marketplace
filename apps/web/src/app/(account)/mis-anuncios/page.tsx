import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PlusCircle, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { getMyListings } from '@/lib/api/anuncios';
import { getProStatus, type ProStatus } from '@/lib/api/billing';
import { MisAnunciosClient } from '@/components/anuncios/MisAnunciosClient';

export const metadata = { title: 'Mis anuncios' };

export default async function MisAnunciosPage() {
  const session = await auth();
  if (!session?.user.accessToken) redirect('/login');

  const token = session.user.accessToken;

  const [{ items }, proStatus] = await Promise.all([
    getMyListings(token),
    getProStatus(token).catch(
      (): ProStatus => ({ isPro: false, limit: 0, used: 0, remaining: 0 }),
    ),
  ]);

  return (
    <div>
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

      <MisAnunciosClient initialListings={items} initialProStatus={proStatus} token={token} />
    </div>
  );
}
