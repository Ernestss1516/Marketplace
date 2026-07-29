import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/auth';
import { buildLoginUrl } from '@/lib/auth/callback-url';
import { getTicketTopics } from '@/lib/api/tickets';
import { getMyListingById } from '@/lib/api/anuncios';
import { getMyInvoices } from '@/lib/api/facturacion';
import { NuevoTicketClient, type LinkedEntity } from './NuevoTicketClient';

export const metadata = { title: 'Abrir ticket' };

/**
 * Resuelve la ETIQUETA de la entidad que llega prefijada por query param, para
 * que el usuario vea con qué está relacionando el ticket y no un id opaco.
 *
 * Es solo PRESENTACIÓN, y por eso es best-effort: si la resolución falla (id
 * manipulado, entidad ajena, borrada), se sigue adelante con una etiqueta
 * genérica en vez de bloquear. La autoridad es el backend, que revalida la
 * propiedad al crear y responde 422 — el `linkedLabel` REAL lo deriva él, nunca
 * este texto (§ del guard de R2). La UI restringe; el backend garantiza.
 */
async function resolveLinked(
  params: { listingId?: string; reviewId?: string; invoiceId?: string },
  token: string,
): Promise<LinkedEntity | null> {
  if (params.listingId) {
    const label = await getMyListingById(params.listingId, token)
      .then((l) => l.title)
      .catch(() => null);
    return { kind: 'listing', id: params.listingId, label: label ?? 'Un anuncio tuyo' };
  }

  if (params.invoiceId) {
    const label = await getMyInvoices(token)
      .then((invoices) => invoices.find((i) => i.id === params.invoiceId))
      .then((inv) => (inv ? `Factura ${inv.number ?? inv.id}` : null))
      .catch(() => null);
    return { kind: 'invoice', id: params.invoiceId, label: label ?? 'Una factura tuya' };
  }

  if (params.reviewId) {
    // Sin endpoint de "una valoración por id" para su protagonista — y no se
    // añade uno solo para pintar una etiqueta. Genérica y honesta.
    return { kind: 'review', id: params.reviewId, label: 'Una valoración' };
  }

  return null;
}

export default async function NuevoTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ listingId?: string; reviewId?: string; invoiceId?: string }>;
}) {
  const session = await auth();
  if (!session?.user.accessToken) redirect(buildLoginUrl('/mis-tickets/nuevo'));

  const params = await searchParams;
  const token = session.user.accessToken;

  const [topics, linked] = await Promise.all([
    getTicketTopics(token).catch(() => []),
    resolveLinked(params, token),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/mis-tickets">
          <ChevronLeft className="mr-1 h-4 w-4" />
          Mis tickets
        </Link>
      </Button>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Abrir un ticket</h1>
        <p className="text-sm text-muted-foreground">
          Cuéntanos qué ha pasado y te respondemos desde aquí mismo.
        </p>
      </div>

      <NuevoTicketClient topics={topics} linked={linked} token={token} />
    </div>
  );
}
