'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getListingPhone } from '@/lib/api/anuncios';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { isCooldownError, formatRetryAfter } from '@/lib/api/client';

interface Props {
  listingId: string;
}

export function PhoneButton({ listingId }: Props) {
  const { data: session } = useSession();
  const { run } = useApiAction();
  const { requireAuth, loginUrl } = useRequireAuth();

  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!requireAuth() || loading || phone) return;
    setLoading(true);
    setError(null);
    await run(
      () => getListingPhone(listingId, session!.user.accessToken!),
      {
        onSuccess: (res) => {
          setPhone(res.phone);
          setLoading(false);
        },
        onError: (err) => {
          setError(
            isCooldownError(err)
              ? `Demasiadas peticiones. Inténtalo de nuevo en ${formatRetryAfter(err.retryAfter)}.`
              : 'No se pudo obtener el teléfono. Inténtalo de nuevo.',
          );
          setLoading(false);
        },
        callbackUrl: loginUrl,
      },
    );
  }

  if (phone) {
    return (
      <Button asChild variant="outline" size="lg" className="w-full">
        <a href={`tel:${phone}`}>
          <Phone className="mr-2 h-5 w-5" />
          {phone}
        </a>
      </Button>
    );
  }

  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="lg"
        className="w-full"
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        ) : (
          <Phone className="mr-2 h-5 w-5" />
        )}
        Ver teléfono
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
