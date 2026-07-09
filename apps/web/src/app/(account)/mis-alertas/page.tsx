import { redirect } from 'next/navigation';
import Link from 'next/link';
import { BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { getMyAlerts } from '@/lib/api/alertas';
import { MisAlertasClient } from './MisAlertasClient';

export const metadata = { title: 'Mis alertas' };

const PER_PAGE = 20;

export default async function MisAlertasPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user.accessToken) redirect('/login');

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const data = await getMyAlerts(session.user.accessToken, page, PER_PAGE);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Mis alertas</h1>

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
