import { redirect } from 'next/navigation';
import { Ilustracion } from '@/components/shared/Ilustracion';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { buildLoginUrl } from '@/lib/auth/callback-url';
import { getMyTickets } from '@/lib/api/tickets';
import { MisTicketsClient } from './MisTicketsClient';

export const metadata = { title: 'Mis tickets' };

const PER_PAGE = 20;

export default async function MisTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; estado?: string }>;
}) {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/mis-tickets'));

  const { page: pageParam, estado } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  // El backend no filtra por "abierto/todos" — no existe ese concepto en la API,
  // que expone los cinco estados. El filtro es de PRESENTACIÓN y se resuelve en
  // el cliente sobre la página ya servida (molde de los filtros de /mis-anuncios).
  const data = await getMyTickets(session.user.accessToken, page, PER_PAGE);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Mis tickets</h1>
        <Button asChild>
          <Link href="/mis-tickets/nuevo">
            <Plus className="mr-2 h-4 w-4" />
            Abrir ticket
          </Link>
        </Button>
      </div>

      {data.total === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center text-muted-foreground">
          {/* E7 — la ilustración ocupa el hueco del icono. El hueco es ESTRUCTURA
              (§8.1); la imagen es el asset. Ver components/shared/Ilustracion.tsx. */}
          <Ilustracion slot="empty-tickets" />
          <p className="text-base">Aún no has abierto ningún ticket.</p>
          <p className="max-w-md text-sm">
            Si tienes una duda o un problema con un anuncio, una valoración o una factura,
            escríbenos y lo vemos.
          </p>
          <Button variant="outline" asChild>
            <Link href="/mis-tickets/nuevo">Abrir mi primer ticket</Link>
          </Button>
        </div>
      ) : (
        <MisTicketsClient
          items={data.items}
          page={page}
          pages={data.pages}
          total={data.total}
          initialFilter={estado === 'todos' ? 'todos' : 'abiertos'}
        />
      )}
    </div>
  );
}
