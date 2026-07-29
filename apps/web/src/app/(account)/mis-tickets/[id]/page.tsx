import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { buildLoginUrl } from '@/lib/auth/callback-url';
import { getTicket } from '@/lib/api/tickets';
import { ApiError } from '@/lib/api/client';
import { TicketThreadClient } from './TicketThreadClient';

export const metadata = { title: 'Ticket' };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl(`/mis-tickets/${id}`));

  // 403 (no es tuyo) y 404 (no existe) se sirven IGUAL: un 404 para lo primero y
  // un 403 para lo segundo dejaría averiguar qué ids de ticket existen. El
  // backend ya distingue por diagnóstico, pero la página pública no lo refleja.
  const ticket = await getTicket(id, session.user.accessToken).catch((err: unknown) => {
    if (err instanceof ApiError && (err.statusCode === 403 || err.statusCode === 404)) return null;
    throw err;
  });
  if (!ticket) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/mis-tickets">
          <ChevronLeft className="mr-1 h-4 w-4" />
          Mis tickets
        </Link>
      </Button>

      <TicketThreadClient initialData={ticket} token={session.user.accessToken} />
    </div>
  );
}
