'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2, Star, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { bumpListing } from '@/lib/api/billing';
import { toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { DestacadoDialog } from './DestacadoDialog';
import type { ListingStatus } from '@/types';

interface Props {
  listingId: string;
  listingSlug: string;
  sellerSlug: string;
  listingStatus: ListingStatus;
}

export function ListingOwnerActions({
  listingId,
  listingSlug,
  sellerSlug,
  listingStatus,
}: Props) {
  const { data: session } = useSession();
  const { run } = useApiAction();

  const [bumpBusy, setBumpBusy] = useState(false);
  const [bumpError, setBumpError] = useState<string | null>(null);
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
        onSuccess: () => setBumpError(null),
        onError: (err) => setBumpError(toUserMessage(err)),
        callbackUrl: `/login?callbackUrl=/anuncio/${listingSlug}`,
      },
    );
    setBumpBusy(false);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Mis opciones</p>

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
          onSuccess={() => setDestacadoOpen(false)}
        />
      )}
    </div>
  );
}
