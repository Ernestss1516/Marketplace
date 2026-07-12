import { redirect } from 'next/navigation';
import { BellOff } from 'lucide-react';
import { auth } from '@/lib/auth';
import { getMyNotifications } from '@/lib/api/notificaciones';
import { NotificacionesClient } from './NotificacionesClient';
import { buildLoginUrl } from '@/lib/auth/callback-url';

export const metadata = { title: 'Notificaciones' };

const PER_PAGE = 20;

export default async function NotificacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/notificaciones'));

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const data = await getMyNotifications(session.user.accessToken, page, PER_PAGE);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Notificaciones</h1>

      {data.total === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center text-muted-foreground">
          <BellOff className="h-12 w-12 opacity-30" />
          <p className="text-base">Aún no tienes notificaciones.</p>
        </div>
      ) : (
        <NotificacionesClient
          initialItems={data.items}
          totalInitial={data.total}
          page={page}
          pages={data.pages}
        />
      )}
    </div>
  );
}
