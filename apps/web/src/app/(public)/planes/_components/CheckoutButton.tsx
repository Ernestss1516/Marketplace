'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { createCheckout } from '@/lib/api/billing';
import { toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';

interface Props {
  priceId: string;
  label?: string;
}

export function CheckoutButton({ priceId, label = 'Hazte Pro' }: Props) {
  const { data: session, status } = useSession();
  const { run } = useApiAction();
  const { requireAuth, loginUrl } = useRequireAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (status === 'loading') return;
    if (!requireAuth()) return;

    setLoading(true);
    setError(null);
    await run(
      () => createCheckout(session!.user.accessToken!, priceId),
      {
        onSuccess: ({ checkoutUrl }) => { window.location.href = checkoutUrl; },
        onError: (err) => { setError(toUserMessage(err)); setLoading(false); },
        callbackUrl: loginUrl,
      },
    );
  }

  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        onClick={handleClick}
        disabled={loading || status === 'loading'}
      >
        {loading ? 'Redirigiendo a Stripe…' : label}
      </Button>
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </div>
  );
}
