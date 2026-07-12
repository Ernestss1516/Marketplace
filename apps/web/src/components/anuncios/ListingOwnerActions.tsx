'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2, Star, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { bumpListing } from '@/lib/api/billing';
import { toUserMessage, isCreditError, isCooldownError, formatRetryAfter, toBumpMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { DestacadoDialog } from './DestacadoDialog';
import type { ListingStatus } from '@/types';

interface Props {
  listingId: string;
  sellerSlug: string;
  listingStatus: ListingStatus;
  featuredUntil?: string | null;
}

export function ListingOwnerActions({
  listingId,
  sellerSlug,
  listingStatus,
  featuredUntil,
}: Props) {
  const { data: session } = useSession();
  const { run } = useApiAction();
  const router = useRouter();
  const { loginUrl } = useRequireAuth();

  const [bumpBusy, setBumpBusy] = useState(false);
  const [bumpError, setBumpError] = useState<React.ReactNode | null>(null);
  const [destacadoOpen, setDestacadoOpen] = useState(false);

  const token = session?.user.accessToken;

  // Only render for the authenticated owner of this listing
  if (!session || session.user.slug !== sellerSlug || listingStatus !== 'ACTIVE') {
    return null;
  }

  async function handleBump() {
    if (!token) return;
    setBumpBusy(true);
    setBumpError(null);
    await run(
      () => bumpListing(token!, listingId),
      {
        onSuccess: () => { router.refresh(); },
        onError: (err) => {
          if (isCreditError(err)) {
            setBumpError(
              <>
                No tienes créditos suficientes para hacer bump.{' '}
                <Link href="/mis-creditos" className="underline hover:text-foreground">
                  Comprar créditos
                </Link>
              </>,
            );
          } else if (isCooldownError(err)) {
            setBumpError(
              `Ya has subido este anuncio, espera ${formatRetryAfter(err.retryAfter)}.`,
            );
          } else {
            setBumpError(toBumpMessage(err));
          }
        },
        callbackUrl: loginUrl,
      },
    );
    setBumpBusy(false);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Mis opciones</p>

      {!featuredUntil && (
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={() => setDestacadoOpen(true)}
          data-testid="owner-btn-destacar"
        >
          <Star className="mr-2 h-4 w-4" />
          Destacar anuncio
        </Button>
      )}

      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start"
        disabled={bumpBusy}
        onClick={handleBump}
        data-testid="owner-btn-bump"
      >
        {bumpBusy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <TrendingUp className="mr-2 h-4 w-4" />
        )}
        Subir al inicio (bump)
      </Button>

      {bumpError && <p className="text-xs text-destructive">{bumpError}</p>}

      {destacadoOpen && token && (
        <DestacadoDialog
          listing={{ id: listingId }}
          token={token}
          open={destacadoOpen}
          onOpenChange={setDestacadoOpen}
          onSuccess={() => { setDestacadoOpen(false); router.refresh(); }}
        />
      )}
    </div>
  );
}
